# realnews

Daily Hebrew news digest: the story itself, plus how coverage splits across the
political map. Static site with a scheduled TypeScript news pipeline.

## How it works

1. `src/pipeline.ts` (dependency-free TypeScript, runs directly on Node 22.18+)
   fetches the RSS feeds in `sources.yaml`, extracts article full text from the
   public article pages (never behind a paywall), clusters articles into
   stories, and writes `site/data.json`.
2. `.github/workflows/daily.yml` runs it at 09:00 and 21:00 Israel time on GitHub Actions and
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

## Hosting on GitHub Pages

The Pages workflow publishes only `site/`, not source files, fixtures or review evidence.
It runs on site changes to `main`, by manual dispatch, and directly after a successful
publishing digest run. The direct call matters: commits made with `GITHUB_TOKEN`
do not trigger another push workflow. Each deployment checks out current `main`.

Before the first deployment:

1. Review the repository's history, PR discussions, Actions logs, artifacts and caches
   for anything that should not become public. Existing artifacts are not made private
   by their names. Older git author metadata includes the owner's email address.
2. Make the repository public only after that disclosure review is approved.
3. In Settings > Pages, select GitHub Actions as the publishing source.
4. Merge this workflow, then run GitHub Pages manually if the merge occurred while
   the repository was still private. Use the URL returned by the deployment.
5. Verify both the feed and story details before retiring the old Vercel hosting.

Workflows skip raw staged/evidence artifact uploads once the repository is public.
Existing artifacts are unaffected and need a separate pre-publicity decision.
Public Actions logs still expose run diagnostics and provider-reported costs.
No workflow deletes or changes the Vercel project.

## Cost

GitHub Pages is available for public repositories on GitHub Free. Standard hosted
Actions runners are free for public repositories, subject to GitHub's limits.
The model pipeline is separate: enabled grouping/synthesis uses OpenRouter and
can spend API credits. Changing the static host does not make model calls free.
This migration does not enable model stages or change their existing budgets.

## תיוג מקורות (רק הבעלים)

ערוך את `sources.yaml` ישירות ב-GitHub (פתח את הקובץ > סמל העיפרון > Commit changes).
לכל מקור שנה את `side` לאחד מ: `right` / `center` / `left` / `unknown`.
כל ערך אחר מטופל כ-`unknown` אוטומטית. מקור `unknown` לא נכנס לחישוב סרגל הכיסוי.
אין תיוג אוטומטי - התווית נכנסת רק אחרי שאתה כותב אותה.

## Local run

```sh
node src/pipeline.ts   # writes site/data.json
node --test test/pipeline.test.ts   # unit tests
cd site && python3 -m http.server 8000
```

### Concurrent edits during publication

The publication step fetches current `main` before pushing its generated-data-only
commit. UI/docs changes and cron/timezone-only edits are preserved by a bounded
rebase. It never force-pushes. If another digest, generation code, source labels,
or workflow behavior changed during the run, publication stops with an explicit
reason and needs a fresh run. It does not rerun the model pipeline automatically.
