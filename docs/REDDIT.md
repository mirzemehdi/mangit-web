# Reddit launch post

Image to attach: `store/2-hover-original.png` (translated page + hover card), or `web/og.jpg`.
Flair: "Promotion" on r/mangapiracy. Post from your own account, answer comments for the first 2 hours.

## Main post (r/mangapiracy)

**Title:** I got tired of slow manga translators, so I made a free one that does a page in ~2 seconds (no account, no API key)

```
I read a lot of raws that never get scanlated, so I tried pretty much every translator tool I could find. They all had the same problems: slow (waiting ages for every single page), or "free" but you have to bring your own OpenAI/Gemini API key and pay per page, or you have to install some desktop app.

So I built my own. It's called Mangit Web and it runs in your browser:

https://mangit.app/translate/

What it does:
- Open a page, or a whole chapter as PDF, CBZ, CBR or EPUB, and press Translate
- About 2 seconds per page. It reads every bubble at the same time instead of one by one
- Japanese, Korean and Chinese, vertical text included, into English or 13 other languages
- Translation is lettered into the bubble, hover any bubble to see the original
- Download the translated chapter as CBZ or PDF
- Free, no account, no API key, no install

If you're on desktop Chrome it can also run on your own computer with Gemini Nano (the AI built into Chrome), so nothing gets uploaded at all. Files you open are never uploaded in any mode, only small crops of the speech bubbles go to the cloud if you use Cloud mode.

There's also a Chrome extension that does the same thing on whatever site you're reading on, in a side panel. It's waiting for Chrome Web Store review, I'll drop the link in the comments when it's live.

It's open source: https://github.com/mirzemehdi/mangit-web

It's new, so it will get things wrong sometimes. There's a Feedback button on the page, I read every message and fix stuff fast. Tell me what breaks or which site/format you want next.
```

## First comment (post it yourself right away)

```
Quick FAQ:
- Is it actually free? Yes. No limits you'll hit in normal reading, no ads, no sign-up.
- Why free? I also make the Mangit app for phones (it cleans the art and redraws the whole page), the web version is how people find it. You don't need the app for anything here.
- Accuracy? On my test pages Cloud mode read 100% of the text correctly and Hybrid 94%. Names are the hardest part, you can add a character name once and it uses that spelling for the whole series.
- Webtoons / colour pages? Works, Cloud mode is best for those.
```

## Shorter version (r/manhwa, r/webtoons, r/manga_raw — check each sub's self-promo rules first)

**Title:** Made a free browser translator for raw manhwa/manga, ~2 s a page, no account or API key

```
Most translators I tried were either slow or wanted my own API key. This one is free, runs in the browser, does a page in about 2 seconds, and handles Korean, Japanese and Chinese (vertical too). You can open a whole chapter (PDF/CBZ/CBR/EPUB) and download it translated.

https://mangit.app/translate/

Open source, and there's a feedback button if something breaks. Would love to hear what you think.
```

## Notes

- Don't name or trash other tools; "slow / needs API key" is enough and readers know which ones.
- Daily cloud limit per browser is 800 bubbles (Remote Config `daily_cloud_requests_per_browser`), so "no limits you'll hit in normal reading" holds. If a post goes viral, watch the $10 budget guard: it pauses Cloud mode (On-device keeps working). Raise the budget in Billing if you want it to keep going.
- Read feedback with `scripts/read-feedback.sh` (or the Mangit repo's `read_user_feedback.sh`, which now includes it).
- r/manga bans self-promotion outside its rules; skip it.
