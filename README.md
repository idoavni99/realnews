# realnews

Daily Hebrew news digest: the story itself, plus how coverage splits across the
political map. Private project, zero-billing architecture.

## How it works

1. `src/pipeline.ts` (dependency-free TypeScript, runs directly on Node 22.18+)
   fetches the RSS feeds in `sources.yaml`, extracts article full text from the
   public article pages (never behind a paywall), clusters articles into
   stories, and writes `site/data.json`.
2. `.github/workflows/daily.yml` runs it every morning on GitHub Actions and
   commits the refreshed `data.json`.
3. `site/index.html` is a static RTL page that renders the feed: headline,
   short summary, and a right/left coverage bar per story.

## Product rules that the code enforces

- **Side labels come only from `sources.yaml`, confirmed by the owner.** Until
  a source is labeled, it is `unknown` and excluded from the coverage bar.
- **"Not monitored" is not "0% coverage".** The bar is computed only across
  sides with at least one healthy source in the latest run. A monitored side
  with no articles shows "לא נמצא במעקב"; an unmonitored side shows a banner.
- **No paywalled content.** Only free public articles are fetched.
- **Original sources are one tap away** from every story.

## Cost

- GitHub Actions: free for public repos; 2,000 free minutes/month for private
  repos (a daily run takes a few minutes). Keep the account's Actions budget at
  $0 so usage can never bill.
- Hosting: GitHub Pages on the Free plan serves public repos only. For this
  private repo, hosting needs a free static host that accepts private repos
  (e.g. Cloudflare Pages) - pending the owner's decision.
- Summaries: extractive by default (no API). An optional LLM summarizer can be
  added later behind an explicit owner decision; nothing calls a paid API today.

## Local run

```sh
node src/pipeline.ts   # writes site/data.json
node --test test/pipeline.test.ts   # unit tests
cd site && python3 -m http.server 8000
```
