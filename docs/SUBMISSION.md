# Devpost submission: Mangit Web

Platform: **Web (Chrome)**. Paste each section into the matching Devpost field.

**Project name:** Mangit Web

**Tagline (≤200 chars):** A free online manga translator that runs on your own computer: Gemini Nano reads speech bubbles in the browser, and only the hard ones go to Gemini in the cloud, in parallel.

**Links**
- Try it (no install): https://mangit.app/translate/
- Code (Apache 2.0): https://github.com/mirzemehdi/mangit-web
- Extension build for judges: https://github.com/mirzemehdi/mangit-web/releases/latest
- Demo video: (YouTube link)

---

## Inspiration

We build [Mangit](https://mangit.app), a mobile app that translates manga, manhwa and manhua pages. Our readers kept telling us two things: they read a lot on computers, and they don't love uploading every page they read. Chrome now ships Gemini Nano, a model that can read images on the reader's own machine. We wanted to see how far a small on-device model can go on real comic pages, and to use the cloud only where it can't.

## What it does

Mangit Web translates the speech bubbles on the page you're reading and letters the translation over them.

- **Chrome extension:** one click on the Mangit icon (or Alt+T) opens the side panel and translates the page. Works on the page you're on, and with **auto-translate** new bubbles translate by themselves as you scroll, without paying twice for bubbles already done. It only asks for access to the site you're reading (activeTab plus an optional per-site grant), never all sites at install. Submitted to the Chrome Web Store.
- **Web demo:** drop in a page, or try our demo chapters, at mangit.app/translate.
- **Three modes:** Hybrid (default), On-device (nothing leaves the computer, works offline) and Cloud.
- **You can see where the AI ran:** each bubble has a small mark (on your computer or cloud), the panel counts how many bubble images went to the cloud, and hovering a bubble shows the original text, the translation and which model read it. The hover card also makes it useful for language learners.
- **Whole chapters from files:** open a PDF, CBZ, CBR or EPUB in the web demo or the extension, translate one page or the whole chapter, and download it translated as CBZ or PDF. Files are read in the browser and never uploaded.
- **Anonymous usage stats:** each translation writes counts only (mode, pages, bubbles on-device vs cloud) to Firestore; a function folds them into daily totals and a public all-time counter, then deletes the raw records. No images, text or URLs are stored.
- **Consistent names:** readers add character names per series; they're shared through Firestore and used by both models.
- **Feedback loop:** a "Send us feedback" button and a short "How was this translation?" prompt after a translation store reports in Firestore (write-only rules), with the run's mode and timings attached so we can reproduce problems.

## How we built it

**Hybrid inference with Firebase AI Logic.** Every bubble request goes through one `getGenerativeModel` call with `InferenceMode.PREFER_ON_DEVICE`, `ONLY_ON_DEVICE` or `ONLY_IN_CLOUD`, the same JSON schema on both sides (`responseConstraint` on-device, `responseJsonSchema` in the cloud), and `response.inferenceSource` tells the UI which model answered each bubble. The cloud backend is Agent Platform (Gemini 3.5 Flash-Lite per bubble, Gemini 3.8 Flash for whole pages).

**The routing is the interesting part:**
1. A bubble detector with no model finds enclosed light regions with ink inside, their shape and text direction, in about 10 ms per page. Nothing is sent.
2. Each bubble is cropped small, so on-device prompts stay far under Nano's 9,216-token limit.
3. We benchmarked Nano per language and found it reads horizontal Korean and Chinese well (93% and 91% of characters right) but vertical Japanese poorly (51%). So Hybrid sends vertical bubbles straight to the cloud, **in parallel**, while Nano reads the rest in order.
4. Bubbles Nano returns empty, untranslated or marked unsure get a cloud second opinion, within a per-page budget.
5. Pages where the detector finds no bubbles (colour webtoons, unusual layouts) go to a cloud model that locates the bubbles itself.

**Firebase products:** AI Logic (hybrid inference), App Check (reCAPTCHA Enterprise on the web demo; a registered debug token in the extension, whose `chrome-extension://` origin reCAPTCHA can't attest), Remote Config (cloud models, thinking level, second-opinion budget, vertical routing, concurrency, all changeable without a release), Firestore + anonymous Authentication (shared glossaries and anonymous usage stats, with security rules that cap every write and forbid client reads of usage records), Cloud Functions (the spending guard and the stats roll-up) and Hosting.

**Measured, not guessed.** We drew 15 test pages (Japanese vertical, Korean, Chinese) with known bubble positions and text, and wrote a benchmark that runs the real pipeline in Chrome with Gemini Nano:

| Mode | Text read right | Names right | Bubbles on your computer | First bubble | Whole page |
|---|---|---|---|---|---|
| On-device | 77% | 63% | 100% | 3.2 s | 13.3 s |
| **Hybrid** | **94%** | 83% | **62%** | **2.0 s** | **9.1 s** |
| **Hybrid + shared names** | 94% | **94%** | 63% | 1.9 s | 8.4 s |
| Cloud | 100% | 92% | 0% | 1.7 s | 2–4 s per page |

Hybrid gets most of the cloud's accuracy while keeping almost two thirds of bubbles private and free, and is faster than on-device alone. Shared names lift name accuracy from 83% to 94%.

## Challenges we ran into

- **Nano and vertical Japanese.** Our first hybrid version trusted Nano's own confidence and sent nothing to the cloud, yet a fifth of its reads were wrong.
- **Nano sometimes runs long.** With a list of names in the prompt it occasionally kept generating for over 20 seconds on Korean bubbles. Softer wording fixed it, and every on-device call now has a time limit: Hybrid hands a slow bubble to the cloud, On-device waits longer and never touches the network. Measuring per language showed the weakness was text direction, which the detector could measure for free. Routing by bubble shape fixed it.
- **Speed.** One cloud call per page took 18 s. Per-bubble cloud calls in parallel took it to under 4 s, and bubbles now appear as they finish.
- **Lettering.** Tall Japanese bubbles are narrow; English broke mid-word. We fit text by whole words, shrink to fit, and widen captions around their centre when they'd become unreadable.
- **App Check in an extension.** reCAPTCHA can't attest a `chrome-extension://` page, so the extension uses a debug token for judging, while the public web demo uses reCAPTCHA Enterprise.
- **Automation.** Testing Nano needed real Chrome with the model downloaded; Playwright's default flags disable the component that delivers it. Our scripts launch Chrome with only the flags Nano needs.

## Accomplishments we're proud of

- A hybrid split that comes from measurement: the cloud is used where the small model is weak, not as a blanket fallback.
- 94% text accuracy with 62% of bubbles never leaving the computer, and 94% of names right with shared glossaries.
- A privacy counter that shows the reader exactly what went to the cloud.
- A reproducible benchmark and an end-to-end extension test anyone can run.

## What we learned

- On-device multimodal models are already good at short horizontal text in small crops. Give them small, focused inputs.
- The best hybrid router is often a cheap, non-AI signal (here: bubble shape) that predicts where the small model fails.
- Self-reported confidence from a small model isn't a reliable escalation signal.

## What's next

- Bring the same on-device path to the Mangit apps through Firebase AI Logic on Android (Gemini Nano) and iOS (Apple Foundation Models), so phones can translate offline too.
- Sound effects, and text drawn outside bubbles.
- Public Chrome Web Store listing (submitted, in review).

## Built with

firebase-ai-logic, gemini-nano, chrome-prompt-api, gemini, agent-platform, firebase-app-check, recaptcha-enterprise, firebase-remote-config, cloud-firestore, firebase-authentication, firebase-hosting, javascript, chrome-extension, pdf.js, pdf-lib, fflate, esbuild, playwright

---

## For existing apps (required field)

**What we built during the submission period:** everything in the Mangit Web repository: the bubble detector, hybrid router, Firebase AI Logic integration, the Chrome extension (with auto-translate), the web demo, the feedback loop, chapter files (PDF, CBZ, CBR, EPUB) with translated downloads, shared glossaries, the benchmark and the test pages. No code from the Mangit apps or their backend is used.

**Core value the existing app provides:** Mangit (live on the App Store and Google Play) gave us the problem knowledge: how readers want bubbles handled, why consistent character names matter, and where translation goes wrong (vertical text, names). Mangit Web is a separate, open, free project that applies that experience to on-device AI in the browser.

**How widely it's used (optional):** (owner to fill: Mangit installs or readers)

## Testing instructions for judges

1. Easiest: open https://mangit.app/translate, pick a chapter and press **Translate page**. In desktop Chrome with Gemini Nano, Hybrid runs partly on-device; otherwise it uses the cloud.
2. Extension: download `mangit-web-extension.zip` from the latest release, unzip, `chrome://extensions` → Developer mode → **Load unpacked**. Open https://mangit.app/translate/reader?c=ko_office and click the Mangit icon in the toolbar: the side panel opens and the page translates in one click (choose **Cloud**, or Hybrid with Nano, in the panel). Then scroll: with **Auto-translate as I scroll** on, new bubbles translate by themselves.
3. For Gemini Nano: Chrome 139+ on desktop, enable `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input`, relaunch, then use **Set up on-device** in the side panel (one-time download).
4. Try **On-device** with Wi-Fi off: it keeps translating.
