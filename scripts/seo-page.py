# One-off: rewrites web/index.html's head, header, intro, FAQ and footer for
# https://mangit.app/translate/ (SEO + JSON-LD). Kept for reference.
import html
import json

p = "web/index.html"
s = open(p).read()
URL = "https://mangit.app/translate/"
ORIGIN = "https://mangit.app"
TITLE = "Free Online Manga Translator | Mangit"
DESC = "Translate manga, manhwa and manhua online, private and at no cost. Open an image or a PDF, CBZ or EPUB chapter. Gemini Nano reads bubbles on your computer."
assert len(TITLE) <= 60 and 70 <= len(DESC) <= 160, (len(TITLE), len(DESC))

FAQ = [
    ("Is Mangit Web free to use?", "Yes. Mangit Web costs nothing and needs no account. It is open source under the Apache 2.0 license."),
    ("Does Mangit Web upload my manga pages?", "Files you open are read in your browser and are never uploaded. In On-device mode, Gemini Nano reads every speech bubble on your computer and nothing leaves it. In Hybrid and Cloud mode, only small crops of speech bubbles are sent to Gemini in the cloud, never the whole page."),
    ("Which browsers does it work in?", "Cloud mode works in any modern browser, including Safari, Firefox and Edge, on computers and phones. On-device and Hybrid mode need Gemini Nano, which desktop Chrome 139 or newer provides. If it is not available, Mangit Web asks before using the cloud."),
    ("What can I translate?", "Japanese, Korean and Chinese manga, manhwa and manhua pages, into 14 languages including English, Spanish, French, German and Portuguese. Open a single image, or a whole chapter as a PDF, CBZ, CBR or EPUB file, and download the translated chapter as CBZ or PDF."),
    ("How accurate is it?", "On our 15 test pages, Hybrid mode read 94% of the text correctly and kept 62% of speech bubbles on the reader's computer. Vertical Japanese is the hardest case for on-device AI, so Hybrid sends those bubbles to the cloud."),
    ("How is Mangit Web different from the Mangit app?", "Mangit Web writes the translation over each speech bubble. The Mangit app for iPhone and Android redraws the whole page in your language, cleans the original text from the art and also translates sound effects."),
    ("Is there a Chrome extension?", "Yes. Mangit for Chrome adds a side panel that translates the manga page you are reading on any website, with the same engine and the same privacy."),
]

ld = {"@context": "https://schema.org", "@graph": [
    {"@type": "WebPage", "@id": URL + "#webpage", "url": URL, "name": TITLE, "description": DESC, "inLanguage": "en",
     "isPartOf": {"@id": ORIGIN + "/#website"}, "about": {"@id": URL + "#webapp"}, "primaryImageOfPage": {"@id": URL + "#image"},
     "breadcrumb": {"@id": URL + "#breadcrumb"}, "publisher": {"@id": ORIGIN + "/#org"}},
    {"@type": "ImageObject", "@id": URL + "#image", "url": URL + "og.jpg", "width": 1200, "height": 630,
     "caption": "Mangit Web translating a Japanese manga page in the browser, with the original and the model that read it shown for one bubble"},
    {"@type": "WebApplication", "@id": URL + "#webapp", "name": "Mangit Web",
     "alternateName": ["Mangit online manga translator", "Mangit manga translator"], "url": URL,
     "description": "A free online manga, manhwa and manhua translator. It finds the speech bubbles on a page, reads them with Gemini Nano on the reader's own computer when the browser supports it, sends only hard bubbles to Gemini in the cloud, and writes the translation over each bubble.",
     "applicationCategory": "MultimediaApplication", "applicationSubCategory": "Manga translator", "operatingSystem": "Any (web browser)",
     "browserRequirements": "Requires JavaScript. On-device and Hybrid mode need Gemini Nano in desktop Chrome 139 or newer; Cloud mode works in any modern browser.",
     "isAccessibleForFree": True, "inLanguage": "en",
     "featureList": [
         "Translates Japanese, Korean and Chinese manga, manhwa and manhua into 14 languages",
         "On-device translation with Gemini Nano: pages never leave the computer",
         "Hybrid mode: hard bubbles such as vertical Japanese go to Gemini in the cloud",
         "Opens images and whole chapters as PDF, CBZ, CBR or EPUB",
         "Downloads the translated chapter as CBZ or PDF",
         "Hover a bubble to see the original text",
         "Works offline in On-device mode"],
     "screenshot": {"@id": URL + "#image"}, "image": URL + "og.jpg", "publisher": {"@id": ORIGIN + "/#org"},
     "isRelatedTo": [{"@id": ORIGIN + "/#app"}, {"@id": URL + "#extension"}], "sameAs": ["https://github.com/mirzemehdi/mangit-web"]},
    {"@type": "SoftwareApplication", "@id": URL + "#extension", "name": "Mangit: Manga Translator for Chrome", "alternateName": "Mangit for Chrome",
     "applicationCategory": "BrowserApplication", "operatingSystem": "Google Chrome (desktop)",
     "description": "A Chrome extension that translates the manga page you are reading on any website from a side panel, with the same hybrid on-device and cloud engine as Mangit Web.",
     "downloadUrl": "https://github.com/mirzemehdi/mangit-web/releases/latest", "isAccessibleForFree": True,
     "publisher": {"@id": ORIGIN + "/#org"}, "isRelatedTo": {"@id": URL + "#webapp"}},
    {"@type": "SoftwareSourceCode", "@id": URL + "#code", "name": "Mangit Web source code", "codeRepository": "https://github.com/mirzemehdi/mangit-web",
     "license": "https://www.apache.org/licenses/LICENSE-2.0", "programmingLanguage": "JavaScript", "runtimePlatform": "Web browser",
     "targetProduct": {"@id": URL + "#webapp"}, "publisher": {"@id": ORIGIN + "/#org"}},
    {"@type": "BreadcrumbList", "@id": URL + "#breadcrumb", "itemListElement": [
        {"@type": "ListItem", "position": 1, "name": "Mangit", "item": ORIGIN + "/"},
        {"@type": "ListItem", "position": 2, "name": "Free online manga translator", "item": URL}]},
    {"@type": "FAQPage", "@id": URL + "#faq", "inLanguage": "en",
     "mainEntity": [{"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in FAQ]},
    {"@type": "Organization", "@id": ORIGIN + "/#org", "name": "Measify Kft", "url": ORIGIN + "/", "logo": ORIGIN + "/images/logo-512.webp"},
    {"@type": "MobileApplication", "@id": ORIGIN + "/#app", "name": "Mangit", "url": ORIGIN + "/", "operatingSystem": "iOS, Android", "applicationCategory": "BookApplication"},
]}

CF = "<script defer src=\"https://static.cloudflareinsights.com/beacon.min.js\" data-cf-beacon='{\"token\": \"f660a20f82364ab190c357176c10e6e8\"}'></script>"
og_title = "Free online manga translator that runs on your computer"
head = f'''<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <!--BASE-->
    <title>{TITLE}</title>
    <meta name="description" content="{DESC}" />
    <link rel="canonical" href="{URL}" />
    <meta name="robots" content="index, follow, max-image-preview:large" />
    <link rel="alternate" hreflang="en" href="{URL}" />
    <link rel="alternate" hreflang="x-default" href="{URL}" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="Mangit" />
    <meta property="og:title" content="{og_title}" />
    <meta property="og:description" content="{DESC}" />
    <meta property="og:url" content="{URL}" />
    <meta property="og:image" content="{URL}og.jpg" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:alt" content="Mangit Web translating a Japanese manga page in the browser" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="{og_title}" />
    <meta name="twitter:description" content="{DESC}" />
    <meta name="twitter:image" content="{URL}og.jpg" />
    <meta name="theme-color" content="#0b0c0f" />
    <link rel="icon" href="icons/icon32.png" />
    <link rel="preload" href="fonts/sora-latin-700-normal.woff2" as="font" type="font/woff2" crossorigin />
    <link rel="preload" href="fonts/baloo-2-latin-700-normal.woff2" as="font" type="font/woff2" crossorigin />
    <link rel="stylesheet" href="app.css" />
    <link rel="stylesheet" href="overlay.css" />
    <script type="application/ld+json">
{json.dumps(ld, ensure_ascii=False, indent=1)}
    </script>
    {CF}
  </head>'''
s = head + "\n" + s[s.index("  <body>"):]

a = s.index('    <header class="site-head">'); b = s.index("    </header>") + len("    </header>")
s = s[:a] + '''    <header class="site-head">
      <div class="wrap head-row">
        <a class="brand" href="https://mangit.app/" aria-label="Mangit home">
          <img src="icons/icon48.png" alt="" width="28" height="28" />
          <span>Mangit</span>
        </a>
        <nav class="head-nav" aria-label="Main">
          <a href="#how">How it works</a>
          <a href="https://mangit.app/guides">Guides</a>
          <a href="#extension">Chrome extension</a>
          <a class="cta" href="https://mangit.app/?utm_source=mangit_web&amp;utm_medium=header">Get the app</a>
        </nav>
      </div>
    </header>''' + s[b:]

a = s.index('      <section class="wrap intro">'); b = s.index("      </section>", a) + len("      </section>")
s = s[:a] + '''      <section class="wrap intro">
        <h1>The free online manga translator that <em>runs on your computer</em>.</h1>
        <p class="dek">
          Mangit Web translates the speech bubbles on manga, manhwa and manhua pages, right in your browser. Try a demo page
          below, or open your own page or a whole PDF, CBZ, CBR or EPUB chapter. In desktop Chrome, Gemini Nano reads the
          bubbles on your own computer; only the hard ones go to the cloud.
        </p>
      </section>''' + s[b:]

faq_html = "\n".join(f'''          <details>
            <summary>{html.escape(q)}</summary>
            <p>{html.escape(a)}</p>
          </details>''' for q, a in FAQ)
old = '      <section id="install" class="wrap install">'
assert old in s
s = s.replace(old, f'''      <section id="faq" class="wrap faq">
        <h2>Questions</h2>
        <div class="faq-list">
{faq_html}
        </div>
      </section>

      <section id="extension" class="wrap install">''')
for a_, b_ in [
    ("<h2>Use it on any page</h2>", "<h2>Mangit for Chrome</h2>"),
    ("<p>The Chrome extension adds a side panel that translates the page you're reading, with the same hybrid engine.</p>",
     "<p>The Chrome extension adds a side panel that translates the manga page you're reading on any website, with the same engine.</p>"),
    ("https://github.com/mirzemehdi/mangit-lens/releases/latest", "https://github.com/mirzemehdi/mangit-web/releases/latest"),
    ("click the Mangit Lens icon", "click the Mangit icon"),
    ("Privacy: Mangit Lens counts", "Privacy: Mangit Web counts"),
    ("utm_source=mangit_lens&amp;utm_medium=web_demo", "utm_source=mangit_web&amp;utm_medium=page"),
]:
    s = s.replace(a_, b_)

a = s.index('    <footer class="site-foot">'); b = s.index("    </footer>") + len("    </footer>")
s = s[:a] + '''    <footer class="site-foot">
      <div class="wrap foot-row">
        <p>Mangit Web is open source (Apache 2.0) on <a href="https://github.com/mirzemehdi/mangit-web">GitHub</a>, built with Firebase AI Logic hybrid inference. By the team behind <a href="https://mangit.app/">Mangit</a>.</p>
        <nav aria-label="Footer"><a href="https://mangit.app/">Mangit app</a> <a href="https://mangit.app/guides">Guides</a> <a href="https://mangit.app/manga-translator">Manga translator guide</a> <a href="https://mangit.app/privacy-policy">Privacy</a> <a href="https://mangit.app/terms-conditions">Terms</a></nav>
      </div>
    </footer>''' + s[b:]
open(p, "w").write(s)

c = open("web/app.css").read()
if ".faq-list" not in c:
    c += '''
/* FAQ */
.faq { padding-top: var(--s8); padding-bottom: var(--s8); border-top: 1px solid var(--hair); }
.faq-list { max-width: 46em; }
.faq details { border-top: 1px solid var(--hair); padding: var(--s4) 0; }
.faq details:last-child { border-bottom: 1px solid var(--hair); }
.faq summary { cursor: pointer; font-size: 18.5px; font-weight: 600; color: var(--text); min-height: 28px; }
.faq summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 4px; border-radius: 4px; }
.faq details p { margin: var(--s3) 0 0; max-width: 36em; color: var(--prose); }
.foot-row { display: flex; flex-wrap: wrap; gap: var(--s4) var(--s6); justify-content: space-between; }
.foot-row nav { display: flex; flex-wrap: wrap; gap: var(--s4); }
.foot-row a { color: var(--text-2); }
'''
    open("web/app.css", "w").write(c)
print("ok", len(TITLE), len(DESC))
