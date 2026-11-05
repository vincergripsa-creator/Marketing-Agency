# Testing and iteration practice for visuals, prices and pages (digital-product sellers and creators, 2024-2026)

Labels used on every claim: **[MEASURED]** = number from a stated sample and method; **[OBSERVATIONAL]** = measured but correlational, not a controlled test; **[OFFICIAL]** = platform documentation of rules or mechanics; **[PLATFORM CLAIM] / [VENDOR CLAIM]** = number published by a platform or tool vendor without a full method (expect selection bias toward wins); **[ANECDOTE]** = a single uncontrolled case; **[OPINION]** = practitioner recommendation; **[DERIVED]** = my own calculation from a cited formula (Inferences only). **[OLD yyyy]** marks data from before 2024. "Secondary" means I read the claim in a third-party source and not on the primary page.

## 1. What gets tested first and most (cover, thumbnail, first image, headline, price, offer, layout, ad creative), typical effect size of each lever, and which levers matter most or least

### Takeaway
The levers tested most are the "click" assets (YouTube thumbnail and title, book cover or first listing image, ad creative concept) and, in stores, price and offer. Generic page-layout tweaks are the most common website tests but rarely produce large effects. Base rates are sobering. Most controlled tests are flat (median lift about 0%), only 12-33% produce a significant winner, and verified winners are usually +5 to +15% relative. Effects of +50 to +100% on click-through rate show up mainly when the visual concept changes a lot (a new cover typography, a new ad concept). Those big effects are usually measured on small samples and shrink when tests are rerun.

### Cited Findings
**Base rates across all levers (website experiments)**
- [MEASURED, 2018-2023] Optimizely analysed 127,000 experiments. Only 12% produced a statistically significant improvement on the primary metric. Revenue-focused experiments delivered an average 0.4% revenue lift. Winning and losing results were about equally likely. A "healthy" program reaches a 35-40% conclusive rate, so about 60% of tests are inconclusive. Optimizely also says a program where nine in ten tests win is suspicious. — [Optimizely, top 10 takeaways](https://www.optimizely.com/insights/top-10-takeaways-from-the-experimentation-playbook/)
- [MEASURED, 2018-2026] Optimizely's later 173k-experiment benchmark covers 1,200+ companies. It counts as a "true experiment" only one with at least 1,000 visitors per arm, and a "win" as at least 90% significance in the winning direction.
  - Over 90% of experiments target five metrics: CTA clicks, pageviews, checkout, registration and add-to-cart. 43% target the bottom of the funnel.
  - "Clarify value" hypotheses make up over a quarter of tests and "win 41%". Findability and urgency hypotheses win 60% and 56%.
  - Caution: these subset win rates are hard to reconcile with the 12% overall figure. The definition of "win" in these subsets is unclear. — [Optimizely, 173k experiments](https://www.optimizely.com/field-notes/guides/173000-experiments)
- [MEASURED, late 2021-2022; slightly older] Analytics-Toolkit meta-analysis of 1,001 A/B tests run on its platform.
  - All tests: median lift 0.08%, mean 2.08%.
  - 33.5% had a statistically significant winning variant. Significant winners had a median lift of +7.5% (mean +15.9%).
  - Non-significant tests averaged -4.9%. — [Analytics-Toolkit](https://blog.analytics-toolkit.com/2022/what-can-be-learned-from-1001-a-b-tests/)
- [MEASURED, OLD 2012] At Microsoft, only about one third of tested ideas improved the metric they were designed to improve (Kohavi et al.). — [Kohavi et al. 2012](https://ai.stanford.edu/%7Eronnyk/2012-09ACMRecSysNR.pdf). Kohavi's slides put the share of ideas that fail at 60-90%, depending on the domain. — [Kohavi slides](https://de.slideshare.net/InfoQ/online-controlled-experiments-introduction-insights-scaling-and-humbling-statistics)
- [MEASURED, KDD 2026] Community replications re-ran popular UI "patterns" at high power: rounded buttons, page performance, coupon-code field, sticky CTA. There were 8 tests, with a median of 2.4M users each and pre-set detectable effects of 0.3-2.2%.
  - Only 2 of 8 were significant in the expected direction. 1 was significant in the opposite direction, and 5 were not significant.
  - The authors call previously reported effects "highly exaggerated" and attribute them to underpowered original tests (power below 50%). — [Vermeer, Kohavi, Linowski et al., KDD 2026](https://www.lukasvermeer.nl/publications/paper/2026/09/02/trustworthy-ab-patterns-and-the-winners-curse.html)

**Ad creative (Meta, app ads)**
- [OBSERVATIONAL, Meta ads launched Sep 2025-Jan 2026] Motion's Creative Benchmarks 2026, now hosted at Runneth, covers 578,750 creatives, 6,015 accounts and $1.29B of spend.
  - Roughly 5% of creatives become "winners", defined as spending at least 10x the account median and at least $500.
  - About half of all ads get little or no spend. About 6% of an account's ads capture the majority of its spend.
  - The report warns that a winner by spend can still lose money on ROAS. — [Runneth, winners are rare](https://runneth.com/library/research/creative-benchmarks-2026/winners-are-rare); dates and scope from [Motion CB2026 overview](https://motionapp.com/library/research/creative-benchmarks-2026/)
- [OBSERVATIONAL, 2024, app marketing] AppsFlyer found that 2% of ad variations commanded 68% of spend, and 90% of spend went to 10% of ads (secondary summary of the 2024 report). — [AppsFlyer 2024 report](https://www.appsflyer.com/resources/reports/creative-optimization-2024/)
- [MEASURED meta-analysis, 2023, secondary] The NCSolutions/Nielsen "Five Keys" study covers about 450 sales-effect studies. Creative drives 49% of incremental sales from advertising, followed by brand 21%, reach 14%, targeting 11% and recency 5%. — [Inside Radio summary](https://www.insideradio.com/free/what-drives-advertising-effectiveness-its-not-what-most-marketers-think/article_8eaae06a-012f-11ef-90e4-5b800fba3731.html)
- [PLATFORM CLAIM, 2025, secondary] Meta attributes about 4% lower cost per result to Advantage+ creative enhancements in link-click, landing-page-view and offsite-conversion campaigns. — [Influencer Marketing Hub](https://influencermarketinghub.com/meta-holiday-blueprint); [Coinis](https://coinis.com/blog/meta-advantage-plus-ai-ads-updates-2025)

**Covers, first images, thumbnails, titles**
- [MEASURED, small samples, updated Aug 2024] An author ran BookBub Ads cover tests on CTR with CPM bidding, $320 in total over 5 rounds (full numbers in Q6).
  - Results ranged from no difference (2.94% vs 2.97%) to a doubling (0.58% vs 1.21%).
  - A large-typography cover reached 5.2% CTR.
  - Free downloads of the permafree first book rose 40% after the new covers. That is a before/after comparison, not a controlled one. — [BookBub Insights](https://insights.bookbub.com/boosted-series-sales-testing-cover-designs/)
- [ANECDOTE, OLD ~2014] Cover redesigns for about 10 indie authors were judged on sales the month before versus the month after. One series went from 15 to 54 sales a month, then 96. The author states there were no controls, and several results were confounded by promotions. — [Creativindie](https://www.creativindie.com/can-a-new-book-cover-double-sales-a-case-study-with-10-authors/)
- [VENDOR CLAIM] PickFu reports a book title change that "impacted performance by 400%", and 76% of polled respondents preferring one cover. — [PickFu on Medium](https://medium.com/pickfu/how-a-book-title-impacted-performance-by-400-dccebe3c091f)
- [PLATFORM CLAIM] Amazon says optimized listing content (images, titles, bullets, A+ content) can raise sales "up to 20%", citing internal data without a method. A single brand testimonial reports +8% after changing one word. — [Amazon Manage Your Experiments](https://sell.amazon.com/tools/manage-your-experiments)
- [OFFICIAL] YouTube picks thumbnail and title winners by watch time, not CTR. It warns that third-party tools that optimize for CTR can name a different winner. — [YouTube Help](https://support.google.com/youtube/answer/13861714). TubeBuddy notes that a CTR winner can have a lower average view duration. — [TubeBuddy support](https://tubebuddy.freshdesk.com/support/solutions/articles/5000707329/thumbs_up)
- [ANECDOTE] One YouTube thumbnail test produced 55.7% more clicks, and another gave an 8% better result (Primal Video). — [Primal Video](https://primalvideo.com/guides/youtube-thumbnail-design-strategy/)

**Price and offer**
- [VENDOR RULE OF THUMB] Intelligems says that, based on "thousands of price tests", a 5% price change typically moves conversion rate about 10% in the opposite direction. It recommends testing price steps of ±5-10%. — [Intelligems](https://www.intelligems.io/resources/blog/how-do-i-run-a-price-test-on-shopify)
- [VENDOR CLAIM] Price-test case results:
  - Dossier: +7.4% profit per visitor sitewide. — [Intelligems](https://www.intelligems.io/resources/customer-stories/how-dossier-used-intelligems-to-increase-profit-per-visitor-7-4-sitewide)
  - Beards & Daisies: +8.25% profit per visitor for the lower price. — [Intelligems](https://www.intelligems.io/resources/customer-stories/how-beards-daisies-increased-revenue-per-visitor-by-10-with-intelligems)
  - Mott & Bow: +5% average profit per visitor. — [Intelligems](https://www.intelligems.io/resources/customer-stories/how-mott-bow-boosted-incremental-profit-30-with-intelligems)
  - Original Grain: top products about 40% more profitable. — [Intelligems](https://www.intelligems.io/resources/customer-stories/how-original-grain-made-top-products-40-more-profitable-with-intelligems)
- [OBSERVATIONAL, cross-product] An analysis of Gumroad listings found software priced at $200+ averaged 19.2 units sold, versus 5.4 for software priced $1-49. This compares different products, not a price test, so it is not causal. — [DEV / InsightRaider](https://dev.to/insightraider/raise-the-price-sell-less-is-backwards-200-gumroad-products-sell-36x-more-units-than-49-45bk)

**Layout and multi-change tests**
- [MEASURED] Optimizely (127k dataset): four-variation experiments deliver 3.5x the expected impact of a typical A/B test, and experiments combining three or more change types deliver the strongest gains. — [Optimizely](https://www.optimizely.com/insights/top-10-takeaways-from-the-experimentation-playbook/)
- [MEASURED] Optimizely (173k dataset):
  - Multi-variant tests deliver up to 1.7x more impact.
  - True multivariate tests are rare, 0.15% of experiments. Of 44 that met quality criteria, 8 produced significant winners, with a 57% median uplift (small n). — [Optimizely 173k](https://www.optimizely.com/field-notes/guides/173000-experiments)
- [MEASURED, small] In a BookBub test, 5 authors each changed one ad-image element (background, 3D cover render, placement, CTA) and ran at least 2,000 impressions per ad. A bold plain background and a 3D ebook render worked better for the authors who tested them. — [BookBub Insights](https://insights.bookbub.com/book-advertising-design-elements-clicks/)

### Inferences
- **Ranking of levers** (synthesis, not a single measured ranking):
  1. **Concept-level visual and message:** ad concept or hook, cover concept and typography, thumbnail concept, title. Ad creative drives about half of advertising's sales effect, and big CTR swings come from concept changes.
  2. **Price and offer:** they move profit per visitor directly. The vendor elasticity rule is about -2 (a 5% price change gives a 10% conversion change). Reported wins are +5 to +40% profit per visitor.
  3. **Page clarity of value:** "clarify value" hypotheses win more often than average at Optimizely.
  4. **Cosmetic UI tweaks and near-duplicate variants**, which matter least. Replications show tiny or zero effects.
- **Significance of the BookBub rounds** [DERIVED, two-proportion z-test on the published numbers]:
  - Round 1 (2.94% vs 2.97%): z≈0.1, p≈0.91. Null.
  - Round 3 (162/5,684 vs 217/6,964): z≈0.87, p≈0.38. **Not significant**, even though it was treated as a win.
  - Round 5 (about 13 vs 27 clicks on 2,200 impressions each): z≈2.2, p≈0.03. Borderline.
  - Small-creator "wins" are often noise.
- The typical verified winner (+7.5% median) is far below the +30-100% claims in creator marketing. Agents should plan around 5-15% gains per confirmed winner and expect most tests to be flat.
- Metric choice changes the lever ranking. A thumbnail that wins on CTR can lose on watch time. A lower price can win on conversion rate and lose on profit. Agents need the platform's own objective (watch time, cost per result, profit per visitor) as the decision metric.

### Gaps
- YouTube publishes no aggregate effect size for Test & Compare. The widely repeated "+23%" and "+30% CTR" figures from third-party blogs could not be traced to any dataset.
- I found no controlled Etsy data on the effect of the first image. The often-cited "90% of Etsy shoppers say photo quality is important" figure could not be verified against Etsy.
- I found no rigorous Gumroad creator price test with dates and revenue. The available material is anecdotes and cross-sectional data.
- No single dataset ranks levers (cover vs price vs headline vs layout) on a common metric. Optimizely's public pages give no breakdown by page area.

## 2. Methods, sample sizes and durations (real-traffic A/B, multivariate, PickFu-style pre-tests, YouTube Test & Compare, Etsy, Meta/TikTok split tests and dynamic creative, Gumroad/Shopify price tests)

### Takeaway
Each platform has its own testing machinery, summarised below. Underneath, the arithmetic is the same: at 80% power and 5% significance you need roughly **16/r² conversions (or clicks) per variant** to detect a relative lift r. That is about 400 for +20% and about 1,600 for +10%. Most small digital-product sellers cannot reach that on purchases within a month. Practitioners therefore test upstream metrics (CTR, which has more events), test large swings, prune options with cheap pre-tests, and accept smaller "test-and-roll" samples when the stakes are low.

| Platform | Variants | Duration | How the winner is picked |
|---|---|---|---|
| YouTube Test & Compare | up to 3 titles, thumbnails or combinations, shown concurrently | a few days to 2 weeks | watch-time share; if no clear winner, the first upload stays the default |
| Meta A/B tests | one variable, mutually exclusive groups | 7-30 days (secondary) | lowest cost per result for conversion objectives; confidence level set beforehand |
| Meta Creative Testing tool | 2-5 ads, at most 20% of budget | default 7 days | compare cost per result, CPC, CPM or a custom event; the API reports "high performers" |
| TikTok split tests | ad groups differing on one variable | 7-30 days | 90% confidence; aim for power ≥80% |
| Amazon Manage Your Experiments | current content (A) vs new (B), or multi-attribute | 8-10 weeks recommended; "to significance" sometimes 4 | statistical significance on units, sales and conversion; auto-publishes the winner |
| Shopify | native Rollouts for themes and checkout (2026); price tests via apps, 2-3 variants | 2-3 weeks for price tests | revenue or profit per visitor once results are stable (no threshold stated) |
| Etsy, Gumroad | no native seller A/B tool found | do-it-yourself, about 2 weeks (Etsy guide) | Etsy: compare CTR of duplicate listings in Etsy Ads reporting |

### Cited Findings
**Sample-size math and real-world test parameters**
- [METHOD, OLD 2010 but standard] Evan Miller's rule of thumb is n = 16·σ²/δ² per group, with σ² = p(1-p) for a conversion rate and δ the absolute minimum detectable effect. — [Evan Miller](https://www.evanmiller.org/how-not-to-run-an-ab-test.html)
- [METHOD, secondary] Kohavi's 2022 memo "Raise the bar on shared A/B tests" uses the same form. The constant 16 corresponds to α = 0.05 and rises to 24 for α = 0.01. — [Kohavi memo](https://docs.google.com/document/d/1sRKParLv0UdOsdAJDTKxPRJstkEDP2Rg/export?format=pdf), as summarised in search results. The PDF itself could not be fetched.
- [MEASURED, 2021-2022] Analytics-Toolkit's 1,001 tests:
  - Duration: median 30 days, mean 35.4.
  - Size: median 60,342 users per test (user metrics) and 72,322 sessions (session metrics).
  - 88% had a single variant against control.
  - About 90% used sequential monitoring. Those stopped at about 64% of the maximum planned time and needed about 26% fewer samples than fixed designs.
  - Most tests were powered at 80% (about a third at 90%), with significance thresholds mostly between 80% and 95%.
  - The median minimum detectable effect was 6% relative, and about two-thirds of tests had one below 10%. — [Analytics-Toolkit](https://blog.analytics-toolkit.com/2022/what-can-be-learned-from-1001-a-b-tests/)
- [MEASURED] Optimizely's Stats Accelerator raised the conclusive rate from 22.3% to 26.0%. About 3 in 4 experiments are simple A/B tests. — [Optimizely 173k](https://www.optimizely.com/field-notes/guides/173000-experiments)
- [THEORY + EMPIRICAL, 2019, Marketing Science] Feit and Berman's "Test & Roll" shows that profit-maximizing test sizes are "substantially smaller" than hypothesis-test sizes, especially when responses are noisy or the population is small. The approach gets close to multi-armed-bandit regret while being easier to run. — [Feit & Berman, arXiv](https://arxiv.org/abs/1811.00457)

**YouTube Test & Compare**
- [OFFICIAL] Mechanics:
  - Up to 3 options per test, as "Title only, Thumbnail only, or Title and thumbnail".
  - Variants are shown concurrently. The winner is the option with the highest watch time.
  - Outcomes are Winner, Performed Same or Inconclusive. Without a clear winner, the first option uploaded becomes the default.
  - A test finishes "within two weeks" and can take "a few days or up to 2 weeks". Desktop Studio only, with advanced features enabled.
  - Excluded: Shorts, scheduled lives, premieres until they convert to long-form, and made-for-kids, mature or private videos.
  - Editing the title or thumbnail during a test stops it.
  - A small share of traffic may be held out as a control group and excluded from results.
  - YouTube advises diverse variants, because similar ones make tests run longer, and testing older videos first to limit risk.
  - The traffic split and the significance threshold are not disclosed. — [YouTube Help](https://support.google.com/youtube/answer/13861714)
- [PRESS, 4 Dec 2025] Title A/B testing rolled out globally to creators with advanced features.
  - The metric is described as watch time per impression.
  - "Inconclusive" can mean too few impressions, and higher view counts make a decisive result more likely.
  - Creators can override the automatic choice. — [Search Engine Journal](https://www.searchenginejournal.com/youtube-title-a-b-testing-rolls-out-globally-to-creators/562571/)
- [PRESS] Thumbnail tests were announced at VidCon 2023 and rolled out in 2024. Title testing expanded in a limited form in mid-2025. — [Tubefilter, 16 Jul 2025](https://www.tubefilter.com/2025/07/16/youtube-feature-test-and-compare-titles-thumbnails/)
- [OPINION] Creators complain that results are often inconclusive, and that per-variant CTR and impressions are not shown (vidIQ video summary). — [vidIQ via Rosetta](https://rosetta.to/u/vidiq/the-most-confusing-youtube-update-ever)
- [VENDOR] TubeBuddy states that the average video gets 40-80 impressions per view, which is why CTR statistics have far more data points than view-based ones. — [TubeBuddy support](https://tubebuddy.freshdesk.com/support/solutions/articles/5000707329/thumbs_up)

**Meta (Facebook/Instagram)**
- [OFFICIAL, Marketing API] Split-test mechanics:
  - Audiences are split into non-overlapping groups, and only one variable should change per test.
  - Up to 150 cells per study and 100 concurrent studies.
  - "Creative Tests" have 2-7 cells with exactly one ad each, and report `high_performer_ids` rather than a confidence-based winner.
  - For conversion objectives, the lowest cost per action wins.
  - The confidence level and attribution model should be decided before the test. Longer schedules tend to give more significant results. — [Meta for Developers](https://developers.facebook.com/docs/marketing-api/guides/split-testing)
- [PRACTITIONER REPORT of official tool, Oct 2025] Meta's in-Ads-Manager Creative Testing tool:
  - Tests 2-5 ads. Meta recommends spending no more than 20% of the budget on the test.
  - Spend is split roughly evenly across test ads, and each person sees only one of them.
  - The default duration appears to be 7 days. The comparison metric is cost per result, CPC, CPM or a custom event, with age and gender breakdowns available.
  - Loomer's opinion: aim for about 50 optimized events per week, and don't overreact, because Meta won't necessarily keep spending on the test winner afterwards. — [Jon Loomer](https://www.jonloomer.com/meta-creative-testing/)
- [SECONDARY, citing Meta Help Center] Classic A/B tests should run at least 7 days and at most 30 days, and 10+ days when customers take more than 7 days to convert. Meta displays an "estimated power" figure, and sources advise aiming for at least 80%. — [AdManage](https://admanage.ai/blog/facebook-ads-ab-testing); [Coinis](https://coinis.com/how-to/how-long-to-test-facebook-ads)
- [SECONDARY, citing Meta] An ad set generally needs about 50 optimization events within 7 days of its last significant edit to exit the learning phase. Vendors report lower thresholds in 2024-2026, which are unverified. — [PPC Land](https://ppc.land/learning-phase/). Loomer argues that failing to exit learning is not fatal, and that significant edits re-enter learning. — [Jon Loomer pubcast, Oct 2025](https://pubcast.jonloomer.com/the-learning-phase-is-just-a-label/)

**TikTok**
- [OFFICIAL] Split tests: run at least 7 days, at most 30 days, and aim for an estimated testing power of at least 80%. Don't change settings once running, use a large audience, and define a hypothesis first. — [TikTok Split Test Best Practices](https://ads.tiktok.com/help/article/split-test-best-practices)
- [OFFICIAL, via search summary] Results read "Winning ad group found" or "No winning ad group found", both at a 90% confidence level. — [TikTok Help](https://ads.tiktok.com/help/article?aid=9877)

**Amazon (relevant to KDP-adjacent sellers and brands)**
- [OFFICIAL] Manage Your Experiments:
  - Available to Brand Registry sellers on products with "enough recent traffic" (no threshold given).
  - Tests images, titles, bullets, descriptions and A+ content, including multi-attribute tests, with a random split.
  - Recommended duration is 8-10 weeks. The "to significance" option can finish in as little as 4 weeks.
  - Reports units, sales, conversion and units per visitor, plus a projected one-year impact. It auto-publishes the winner by default and offers ML-suggested titles and A+ content based on "thousands of earlier experiments".
  - Amazon advises running the full duration because early results mislead. — [Amazon](https://sell.amazon.com/tools/manage-your-experiments)

**Shopify, Gumroad and Etsy**
- [SECONDARY] Shopify Rollouts is a native A/B and staged-release feature that appeared in early access with the Winter '26 Edition (January 2026). It covers themes and checkout, was expanded in Spring/Summer '26, and doesn't support vintage themes or multi-page funnel tests. — [Charle agency](https://www.charleagency.com/articles/shopify-rollouts/); [Intelligems on Spring '26](https://www.intelligems.io/resources/blog/shopify-spring-26-editions-what-the-updates-mean-for-your-profit)
- [VENDOR GUIDANCE] Price tests on Shopify through apps:
  - Run at least 2 weeks, ideally about 3. Weekday/weekend and payday cycles matter.
  - "Straddle" with 3 variants (control, lower, higher) in 5-10% steps. Under 5% is often "too close to call".
  - Judge on revenue or profit per visitor, not conversion rate. Call a winner only after results are stable for several days.
  - No significance threshold is stated. Don't test during sitewide sales, and keep ads price-agnostic. — [Intelligems](https://www.intelligems.io/resources/blog/how-do-i-run-a-price-test-on-shopify)
- [SECONDARY] Etsy has no native A/B tool for sellers. The suggested do-it-yourself method uses duplicate listings with identical prices, a two-week baseline, and CTR read from Etsy Ads reporting. — [eListit guide](https://elistit-web.pages.dev/guides/etsy-thumbnail-optimization/)
- [OFFICIAL] On Etsy, the search thumbnail is a crop of the primary photo. The first photo should be at least 635 px on each side or the listing may rank lower, and landscape or square so the crop keeps the focal point. — [Etsy Help, image requirements](https://help.etsy.com/hc/articles/115015663347); [Etsy Help, editing photos](https://help.etsy.com/hc/en-us/articles/360016260113-How-to-Edit-Your-Listing-Photos)

**Pre-tests (PickFu-style panels) and human prediction**
- [VENDOR DOCS] PickFu:
  - Sample sizes: the default is 30 respondents, 15 gives "quick directional" feedback, 50 is "solid for most decisions", and 100-200 is advised before costly, hard-to-reverse changes. Iteration polls can use about 15 respondents, with about 50 for baseline and validation polls.
  - Reading results: 70%+ agreement is a strong signal, 55-70% moderate, and near 50/50 weak.
  - Book-cover polls show 2-4 options in random order and can target, for example, Prime members or reading frequency. Demographic breakdowns can show a split that differs from the overall one.
  - Turnaround time is not stated in the docs. — [PickFu cover comparison](https://www.pickfu.com/docs/use-cases/book-cover-comparison.md); [PickFu best practices](https://www.pickfu.com/docs/guides/best-practices.md)
- [MEASURED, OLD Nov 2022] Humans guessing A/B outcomes:
  - 70,149 guesses on GuessTheTest were correct about 59% of the time, against a 50% chance baseline.
  - Participants in Kohavi's class were right about 48%, against a 33% baseline with three outcomes.
  - Accuracy per test ranged from about 13% to 94%. — [GoodUI](https://goodui.org/blog/beyond-opinions-about-opinions-real-a-b-test-prediction-rates-from-70-000-guesses/)

**How the BookBub-style ad test is run**
- [PRACTITIONER, 2024] BookBub tests use CPM bidding so each ad gets similar reach, change only one element, keep targeting and budget fixed, and require at least 2,000 impressions per ad before comparing CTR. — [BookBub test post](https://insights.bookbub.com/boosted-series-sales-testing-cover-designs/); [BookBub design elements](https://insights.bookbub.com/book-advertising-design-elements-clicks/)

### Inferences
- **[DERIVED] Sample size per variant** at 80% power and two-sided α = 0.05, using n = 16·p(1-p)/(p·r)²:

| Baseline rate p | Relative lift r | Units per variant (impressions or visitors) | Events per variant (clicks or sales) |
|---|---|---|---|
| 1% (ad CTR) | +20% | 39,600 | ~396 |
| 2% | +10% | 78,400 | ~1,568 |
| 2% | +20% | 19,600 | ~392 |
| 2% | +50% | 3,136 | ~63 |
| 3% (product page) | +10% | 51,733 | ~1,552 |
| 3% | +20% | 12,933 | ~388 |
| 5% | +5% | 121,600 | ~6,080 |
| 5% | +10% | 30,400 | ~1,520 |
| 5% | +20% | 7,600 | ~380 |
| 5% | +50% | 1,216 | ~61 |

  - **General rule:** events per variant ≈ 16(1-p)/r². That gives about 1,600 events for +10%, 400 for +20%, 178 for +30%, 64 for +50% and 16 for +100%.
  - At TikTok's 90% confidence the constant drops to about 12.4, roughly 21% fewer samples. At 99% it rises to about 23.4. (Exact constant at 95% is 15.7.)
- **[DERIVED] Worked example.** A digital-product page with 3,000 visitors a month converting at 3% would need about 8.6 months to detect +20% (≈12,933 visitors per arm × 2). It would need about 1.4 months to detect +50% (≈2,069 per arm × 2). Small sellers can only read big swings on purchases. They should test CTR-level assets (thumbnail, cover, first image, ad). At a 2-5% page conversion rate, clicks are roughly 20-50x more frequent than purchases. Purchases should be read only for price and offer changes with large expected effects.
- **Running order for an agent pipeline:**
  1. Cheap pre-test, such as a 15-50 person panel or an internal scoring step, to drop clear losers. Human and panel judgement beats chance only modestly (about 59% vs 50%), so it can only prune.
  2. Live CTR test on the platform's native tool, for at least 7 days or until about 400 clicks per arm for a +20% read.
  3. Conversion or profit test only for price and offer.
  4. Keep at most 20% of spend in exploration, as Meta's own testing tool recommends.
- **Why sequential designs:** the Analytics-Toolkit data shows they save about 25% of the sample while keeping error rates valid. An automated agent should use a sequential or Bayesian stopping rule rather than "stop when significant".
- **Before/after "tests" on Gumroad, Etsy or KDP**, where there is no native split, are confounded by seasonality, promotions and ranking changes. Where possible, agents should prefer randomised splits (Amazon, YouTube, Meta, Shopify apps) or paid-ad CTR tests of the visual.

### Gaps
- Meta's own Business Help Center pages ("About A/B testing", "Best practices") returned only titles, because they are JavaScript-rendered. The 7-30 days, 80% estimated power and 10-day conversion-lag rules are therefore secondary.
- YouTube does not publish the traffic split, the significance threshold or the minimum impressions behind Test & Compare.
- PickFu's turnaround time and its predictive validity against live A/B tests: I found no independent validation study. The only evidence is vendor case studies.
- Gumroad: I found no documented native A/B or price-testing feature. Creators appear to rely on sequential price changes, which is unverified.
- Official TikTok and Meta minimum budgets for tests were not verified.

## 3. Iteration cadence: how often top advertisers refresh creatives, variants per month, creative libraries, and moving from exploration to exploitation

### Takeaway
Cadence scales with spend. Meta advertisers launch about 3 new creatives a week under $10K/month and about 19 a week above $1M/month. Only about 4-9% become winners, so it takes roughly 11-25 launches per winner. The platforms then exploit automatically, concentrating spend on about 2-6% of ads. Refresh is triggered by fatigue signals (cost per result rising against the ad's own history) rather than a fixed calendar. Since Meta's 2025 Andromeda changes, the system rewards conceptually different creatives and groups near-duplicates together. Top teams keep tagged libraries so later tests start from prior results.

### Cited Findings
- [OBSERVATIONAL, Meta, Sep 2025-Jan 2026] Average new creatives launched per week, by monthly spend tier, with hit rates:

| Spend tier | Monthly spend | New creatives per week | Hit rate |
|---|---|---|---|
| Micro | <$10K | 2.8 | 4.0% |
| Small | $10-50K | 4.1 | 6.4% |
| Medium | $50-200K | 6.6 | 8.1% |
| Large | $200K-1M | 11.2 | 8.6% |
| Enterprise | $1M+ | 18.8 | 8.8% |

  - Enterprise tests 6.7x Micro's volume, while hit rate only roughly doubles.
  - Top-quartile accounts test 1.5-3x their tier average; top-quartile Medium accounts launch 15.9 a week.
  - Only accounts with at least 10 unique creatives are included. — [Runneth, testing volume by tier](https://runneth.com/library/research/creative-benchmarks-2026/testing-volume-by-tier)
  - Caution: another page of the same report gives hit rates of about 3.8-8.2%. — [Runneth, winners are rare](https://runneth.com/library/research/creative-benchmarks-2026/winners-are-rare)
- [OBSERVATIONAL] At a 5% hit rate, 4 ads a week yield about 0.2 winners a week, and 18 ads a week about 0.9. — [Runneth, winners are rare](https://runneth.com/library/research/creative-benchmarks-2026/winners-are-rare)
- [OBSERVATIONAL, 2025, mobile apps] AppsFlyer covered 1.1M video creative variations from 1,300 apps that each ran at least 200 variations.
  - High-spending non-gaming apps averaged 2,365 variations per quarter, up 18% year over year.
  - Apps spending $7M+ per quarter produced nearly 3x the creatives of those spending $4-7M.
  - An AppsFlyer executive describes marketers "scaling variety", not only top performers. — [AppsFlyer press release](https://www.appsflyer.com/company/newsroom/pr/ai-emotion-creative-trends/)
- [MEASURED] Website experimentation velocity: the median company runs 34 experiments a year, the top 10% need about 200, and the top 3% run over 500. — [Optimizely](https://www.optimizely.com/insights/top-10-takeaways-from-the-experimentation-playbook/)
- [PRACTITIONER, 2025] Meta dropped its long-standing "no more than six ads per ad set" guidance in early 2025. Loomer writes that advertisers may now create 10, 20 or even 50 ads in one ad set, but warns against creating ads just to fill space. — [Jon Loomer, Andromeda](https://www.jonloomer.com/meta-andromeda/); [Jon Loomer, creative diversification](https://www.jonloomer.com/meta-andromeda-creative-diversification/)
- [SECONDARY, thresholds unverified] Meta's Andromeda reportedly collapses highly similar ads into one "entity". Advertisers see at best a "creative similarity" proxy, and Meta publishes no official threshold. — [Nikhil](https://nikhil.pro/meta-ads-creative-similarity-explained/); [Knowlify](https://knowlify.com/articles/meta-andromeda-creative)
- [OFFICIAL, consistent with the above] YouTube warns that similar thumbnail variants make tests run longer. — [YouTube Help](https://support.google.com/youtube/answer/13861714)
- [SECONDARY, citing Meta Help Center] Meta flags fatigue in the Delivery column with two labels:
  - "Creative limited": cost per result above the advertiser's past ads, but under 2x.
  - "Creative fatigue": cost per result at 2x or more.
  - Meta publishes no frequency threshold. — [Admetrics](https://admetrics.io/en/post/meta-creative-fatigue-and-similarity-score-complete-guide); [Atria](https://www.tryatria.com/blog/meta-creative-fatigue-diagnose-and-fix-2026)
- [OFFICIAL, via search summary] TikTok frames fatigue as needing a steady stock of creatives ready to swap in and points to Smart Creative automation. No fixed refresh interval was found. — [TikTok creative best practices](https://ads.tiktok.com/help/article/creative-best-practices). [OPINION] Practitioners report TikTok ads fatiguing within days to two weeks, sometimes 48-72 hours at high spend. — [Influee](https://influee.co/blog/tiktok-ad-fatigue)
- [OPINION, unverified quote] The "3-2-2" structure crosses 3 creatives × 2 primary texts × 2 headlines into 12 dynamic combinations within a proven angle. Its originator, Charley Tichenor, reportedly said in September 2025 that Andromeda made it insufficient on its own, and that top advertisers now test multiple concepts per segment. — [AdAdvisor skill page](https://adadvisor.ai/docs/skills/adadvisor-creative)
- [OPINION, vendor] Creative library practice: tag every ad on a fixed taxonomy of 5-6 dimensions (hook, format, angle, offer, CTA, audience) with controlled values. Tag before looking at performance, then compare metrics by tag value to see which styles are winning, saturating or missing. — [Segwise](https://segwise.ai/blog/creative-tag-taxonomy)
- [MEASURED, platform usage] At Optimizely, 19.54% of follow-up tests are driven by AI-agent recommendations "grounded in prior results". — [Optimizely](https://www.optimizely.com/insights/top-10-takeaways-from-the-experimentation-playbook/)
- [OFFICIAL] Amazon suggests titles and A+ content from "thousands of earlier experiments" on similar products, which works as a platform-level library of winners. — [Amazon](https://sell.amazon.com/tools/manage-your-experiments)
- **Moving from exploration to exploitation**
  - [MEASURED] Optimizely: with 2 variations, bandits beat an even split 49.7% of the time. With 3 or more, they beat it 63.9% of the time (29% more often). — [Optimizely 173k](https://www.optimizely.com/field-notes/guides/173000-experiments)
  - [THEORY] Profit-maximizing "test & roll" designs get close to bandit regret while being simpler to run. — [Feit & Berman](https://arxiv.org/abs/1811.00457)
  - [OFFICIAL, Meta tool] Exploration share: at most 20% of budget in Meta's Creative Testing tool. — [Jon Loomer](https://www.jonloomer.com/meta-creative-testing/)
  - [OFFICIAL] Exploitation is automated: Amazon auto-publishes winners, and YouTube makes the winner the default for all viewers. — [Amazon](https://sell.amazon.com/tools/manage-your-experiments); [SEJ](https://www.searchenginejournal.com/youtube-title-a-b-testing-rolls-out-globally-to-creators/562571/)

### Inferences
- **[DERIVED] Launches per winner ≈ 1/hit rate:** about 25 at a 4% hit rate and about 11 at 8.8%. A small agency client at Micro or Small spend (3-4 creatives a week) gets about one Meta winner every 1-2 months. Proving improvement needs months of logged history, not a single test.
- **Realistic agent cadence:**
  - Each week, launch a batch of 3-5 *conceptually distinct* variants (different hook, angle or format, not colour tweaks).
  - Cap exploration at about 20% of spend.
  - Let the platform's allocation identify candidates, then confirm the top 1-2 in a proper split or Creative Test.
  - Retire an ad when cost per result reaches about 2x its own history.
  - Log every variant with tags and outcome, losers included, so the library feeds the next brief.
- **Bandits** (or the platform's own allocation) suit many-variant, short-lived assets such as ads and thumbnails. Fixed-horizon tests suit few-variant, long-lived decisions such as price, cover or page template, where the long-run effect and its size matter.
- **Spend concentration is a weak winner signal** (half of ads get almost no spend). Ads the platform starved were never really tested. The agent should not label them "losers" with confidence. Mark them "untested" or "low-delivery".

### Gaps
- I found no primary 2024-2026 source giving a measured creative lifespan (days until fatigue) for Meta or TikTok. Refresh-interval claims are practitioner rules of thumb.
- I found no data on how often top YouTube creators retest thumbnails or titles, or how often Etsy and Gumroad sellers refresh listing visuals.
- Meta has not officially confirmed the similarity-grouping thresholds.

## 4. Known pitfalls (peeking, novelty, regression to the mean, seasonality, small samples, winner's curse) and how professionals avoid them

### Takeaway
The dominant failure modes are: stopping when the result first looks significant (peeking), underpowered tests that inflate the size of winners (winner's curse and regression to the mean), and changing things mid-test. Others are reading a proxy metric that differs from the business goal, and before/after comparisons confounded by promotions or seasonality. Professionals fix the sample size in advance or use sequential or Bayesian rules, run whole weekly cycles (2-4 weeks), change one variable at a time, keep holdouts and re-test big wins, and shrink reported effects.

### Cited Findings
**Peeking**
- [MEASURED by simulation, OLD 2010] Evan Miller's example checks a test that has no real effect repeatedly and stops at the first p < 0.05. The false-positive rate rises to 26.1%, "more than five times" the nominal 5%.
  - To keep a real 5% error rate, the nominal threshold must drop to 2.9% with 1 peek, 1.8% with 3 peeks and 1.0% with 10 peeks.
  - Remedies: fix the sample size in advance, use sequential designs with pre-set checkpoints, or use Bayesian designs. For tool builders, he advises not reporting significance until the end, showing the detectable effect size for the current sample instead, and considering hiding the running estimate. — [Evan Miller](https://www.evanmiller.org/how-not-to-run-an-ab-test.html)
- [MEASURED, OLD: 2,101 Optimizely experiments from 2014] Berman, Pekelis, Scott and Van den Bulte found:
  - About 73% of experimenters stop just when a positive effect reaches 90% confidence (57% in another version of the paper).
  - About 70-75% of tested effects are truly null.
  - Optional stopping raises the false discovery rate from 33% to 40% (42% in another version). — [SSRN](https://papers.ssrn.com/abstract=3204791); [MSI report](https://thearf-org-unified-admin.s3.amazonaws.com/MSI/2020/06/MSI_Report_18-130-1.pdf)
- [MEASURED] In practice, about 90% of Analytics-Toolkit tests used valid sequential designs (planned about 10.8 looks, stopped at about 5.6). — [Analytics-Toolkit](https://blog.analytics-toolkit.com/2022/what-can-be-learned-from-1001-a-b-tests/)

**Winner's curse, regression to the mean and low power**
- [MEASURED, OLD 2017, read via search summary because the page returned 403] Airbnb summed six "winning" experiment estimates to 7.2%, while a holdout measured 4%. A bias correction gave 5.3%. — [Airbnb Engineering](https://medium.com/airbnb-engineering/selection-bias-in-online-experimentation-c3d67795cceb)
- [MEASURED, KDD 2026] High-power replications of published "winning" UI patterns: 2 of 8 replicated, 1 reversed and 5 were null. The originals likely came from tests with power below 50%. — [Vermeer, Kohavi et al.](https://www.lukasvermeer.nl/publications/paper/2026/09/02/trustworthy-ab-patterns-and-the-winners-curse.html)
- [MEASURED] Significant winners average +15.9% (median +7.5%) while all tests have a median of +0.08%. That gap is consistent with selection inflating winners. — [Analytics-Toolkit](https://blog.analytics-toolkit.com/2022/what-can-be-learned-from-1001-a-b-tests/)
- [OFFICIAL / VENDOR] Platforms warn against early reads:
  - Amazon says early results can mislead, so run the full duration. — [Amazon](https://sell.amazon.com/tools/manage-your-experiments)
  - Intelligems says a leader after a few days may not hold. — [Intelligems](https://www.intelligems.io/resources/blog/how-do-i-run-a-price-test-on-shopify)
  - Optimizely calls a nine-in-ten win rate suspicious. — [Optimizely](https://www.optimizely.com/insights/top-10-takeaways-from-the-experimentation-playbook/)

**Novelty and primacy**
- [SECONDHAND Kohavi guidance] Kohavi advises running experiments long enough for the novelty effect to wear off. — [Kohavi quote collection](https://www.antoinebuteau.com/lessons-from-ronny-kohavi/)
- [OPINION] Novelty shows up as an effect that decays toward a smaller steady state. A common rule is to plot the daily treatment effect, but there is no universal "N days". — [Atticus Li](https://atticusli.com/replication-crisis/ab-testing-novelty-primacy-effects/)

**Seasonality, cycles and conversion lag**
- [VENDOR GUIDANCE] Weekday/weekend and payday cycles distort short tests, so run 2-3 weeks. Never test during a sitewide sale. Ads quoting a specific price break a price test. — [Intelligems](https://www.intelligems.io/resources/blog/how-do-i-run-a-price-test-on-shopify)
- [SECONDARY, citing Meta] Run 10+ days if customers take more than 7 days to convert. — [AdManage](https://admanage.ai/blog/facebook-ads-ab-testing)
- [MEASURED] A median test duration of 30 days in practice. — [Analytics-Toolkit](https://blog.analytics-toolkit.com/2022/what-can-be-learned-from-1001-a-b-tests/)

**Mid-test changes and test hygiene**
- [OFFICIAL] On YouTube, editing the title or thumbnail during a test stops it. — [YouTube Help](https://support.google.com/youtube/answer/13861714)
- [OFFICIAL] TikTok says don't change split-test settings once a test is running. — [TikTok](https://ads.tiktok.com/help/article/split-test-best-practices)
- [OFFICIAL] Meta says to change only one variable per test and to decide the confidence level and attribution model before starting. — [Meta for Developers](https://developers.facebook.com/docs/marketing-api/guides/split-testing)
- [PRACTITIONER] On Meta, significant edits send an ad set back into learning. — [Jon Loomer](https://pubcast.jonloomer.com/the-learning-phase-is-just-a-label/)

**Proxy metric not matching the business goal**
- [OFFICIAL] YouTube judges on watch time, not CTR. — [YouTube Help](https://support.google.com/youtube/answer/13861714)
- [VENDOR] A CTR winner can have a lower average view duration. — [TubeBuddy](https://tubebuddy.freshdesk.com/support/solutions/articles/5000707329/thumbs_up)
- [VENDOR] Conversion rate misleads in price tests; use profit per visitor. — [Intelligems](https://www.intelligems.io/resources/blog/how-do-i-run-a-price-test-on-shopify)
- [OBSERVATIONAL] A winner by spend can be ROAS-negative. — [Runneth](https://runneth.com/library/research/creative-benchmarks-2026/winners-are-rare)
- [MEASURED] Even at a median of 2.4M users, revenue and purchase metrics lacked power, so the KDD replications used CTR and add-to-cart as surrogates. — [Vermeer, Kohavi et al.](https://www.lukasvermeer.nl/publications/paper/2026/09/02/trustworthy-ab-patterns-and-the-winners-curse.html)

**Platform interference and confounds**
- [PRESS, OLD Aug 2023] Etsy search showed non-primary photos (packaging, back sides) as thumbnails for some listings, with no Etsy statement. Sellers cannot fully control or test what is displayed. — [Value Added Resource](https://www.valueaddedresource.net/etsy-scrambles-thumbnails-in-search/)
- [ANECDOTE, OLD ~2014] Before/after cover studies were confounded by BookBub promotions and holiday competition, and the author states there were no controls. — [Creativindie](https://www.creativindie.com/can-a-new-book-cover-double-sales-a-case-study-with-10-authors/)

**Pre-test validity**
- [VENDOR] PickFu measures stated preference among panelists. Its own docs warn that mismatched image quality skews results toward production quality rather than concept. — [PickFu best practices](https://www.pickfu.com/docs/guides/best-practices.md)
- [ANECDOTE] An indie author wished PickFu could poll avid readers of her genre, which points to respondent fit as a limit. — [Sheer Hubris](https://www.sheerhubris.com/tag/pickfu/)

### Inferences
- **Guardrails for an automated agent:**
  - Pre-register the hypothesis, the metric, the minimum detectable effect and the stopping rule. Use a sequential or Bayesian rule, never "stop at first significance".
  - Run at least 7 days and whole weeks. For price and pages, run 2-4 weeks.
  - Freeze the asset during the test, and change one concept per test.
  - Compute power before launching. If the needed sample can't be reached, test a bigger swing or move to a higher-frequency metric.
  - Shrink every observed lift before logging it in the library. For example, halve effects from tests under 50% power; the KDD and Airbnb evidence suggests large shrinkage is normal.
  - Re-test any "win" above about +30% before rolling it out widely.
  - Keep a small holdout or periodically re-run the old champion to check that the gains are real (the Airbnb holdout logic).
- **[DERIVED] Small samples:** the BookBub round-3 "win" had p ≈ 0.38. Agents should attach a significance or credible interval to every creator-scale result before calling it a winner.
- Treat novelty specially for returning audiences (YouTube subscribers, email lists, retargeting). A fresh-looking cover or thumbnail may spike briefly. Compare week 1 with weeks 2-3 before locking in a winner.

### Gaps
- I did not retrieve a primary measured example of novelty-effect decay (magnitude over weeks) for visual or creative changes. Guidance found is secondhand.
- No primary source covers sample-ratio-mismatch or A/A-test rates on creator platforms (YouTube, Meta Creative Testing). These checks are standard in Kohavi's work but were not retrieved here.
- Airbnb's post (2017) returned HTTP 403, so its figures come from the search summary.

## 5. Do sellers adapt visuals by niche or audience, and does personalisation help measurably?

### Takeaway
Measured evidence that segment-specific visuals help exists, but it is thin and comes mostly from large platforms. Optimizely finds audience-targeted experiments deliver 17.4% higher impact on the targeted audiences, diluted when rolled out to everyone. Netflix's per-member artwork, chosen by contextual bandits, produced a "significant lift" (2017-18, no public number). Creator tools such as YouTube Test & Compare pick one global winner. Ad platforms now do the person-level matching themselves when given conceptually diverse creatives. For small digital-product sellers, the practical and measurable form is niche or genre fit of the cover, and that is supported only by anecdotes and panel data.

### Cited Findings
- [MEASURED, observational] Optimizely 173k:
  - Audience-targeted experiments show 17.4% higher impact (ATI) on their targeted audiences, and reach can dilute this.
  - After adopting Optimizely AI, companies run 65.4% more personalized experiments per year. — [Optimizely 173k](https://www.optimizely.com/field-notes/guides/173000-experiments)
- [MEASURED, OLD 2017-2018] Netflix frames artwork choice as an online contextual multi-armed bandit that selects one image per member and title. It trained on logs from a prior unpersonalized system. In an A/B test against unpersonalized bandits, personalization gave "a significant lift" in core metrics, with no figures published in the sources found. — [QCon SF 2018](https://qconsf.com/sf2018/node/110208.html); [Reforge brief](https://www.reforge.com/blog/brief-netflix-artwork-personalization-through-multi-armed-bandit-testing)
- [OFFICIAL] YouTube Test & Compare makes the winning title or thumbnail the default for all viewers, with no per-segment winner. — [SEJ](https://www.searchenginejournal.com/youtube-title-a-b-testing-rolls-out-globally-to-creators/562571/); [YouTube Help](https://support.google.com/youtube/answer/13861714)
- [PRACTITIONER REPORT of an official tool] Meta's Creative Testing tool offers age and gender breakdowns of results. — [Jon Loomer](https://www.jonloomer.com/meta-creative-testing/). [OPINION] Since Andromeda, practitioners argue "creative diversification is the new targeting": diverse concepts let the algorithm match ads to people. — [Jon Loomer pubcast, 3 Sep 2025](https://pubcast.jonloomer.com/creative-diversification-is-the-new-targeting/)
- [VENDOR GUIDANCE] PickFu says a 50/50 overall split can be 80/20 within the target segment. It advises matching the panel to real customers (for example Prime members, or reading frequency for books). — [PickFu best practices](https://www.pickfu.com/docs/guides/best-practices.md); [PickFu cover comparison](https://www.pickfu.com/docs/use-cases/book-cover-comparison.md)
- [ANECDOTE, OLD 2022] An SFWA columnist reports that indie authors' cover changes boosted sales when the new covers matched reader expectations for genre and storyline. — [SFWA](https://www.sfwa.org/2022/09/21/indie-files-book-cover-fired/)
- [CONSULTING CLAIM, secondary; year reported as 2021 or 2023] McKinsey: personalization most often drives a 10-15% revenue lift, with company-specific results of 5-25%. This is not an experiment, and the original page timed out. — [Business Chief](https://businesschief.com/technology-and-ai/mckinsey-prioritise-personalisation-for-10-15-revenue-lift)

### Inferences
- For a digital-product agency, the useful unit of personalisation is the **niche or segment, not the individual**. That means a cover style or first image per niche product line, per marketplace (Etsy vs Gumroad vs Amazon) and per ad audience. Person-level matching is left to Meta and TikTok's algorithms, fed with diverse concepts.
- **[DERIVED] Segmentation multiplies the sample-size problem.** Each segment needs its own ~16/r² events. Three segments that each need +20% detection need about 3 × 400 = 1,200 events per variant. Per-segment testing is only realistic on high-traffic CTR metrics.
- Expect segment-targeted variants to show bigger effects inside the segment than when shipped to everyone (the Optimizely dilution finding). Agents should evaluate a segment-specific visual only on the segment it targets.

### Gaps
- Netflix's lift figures are not public in the sources found, and the material is from 2017-2018.
- I found no measured study of KDP, Etsy or Gumroad sellers using different covers for different segments or markets. The evidence is anecdotal.
- No platform data was found on whether Meta's Advantage+ creative personalisation beats manual segment-specific creative. Meta's ~4% claim is not broken down by segment.

## 6. Examples and case studies with numbers (Etsy, Gumroad, KDP covers, YouTube thumbnails, DTC creative testing frameworks)

### Takeaway
The only large, recent, numeric datasets are platform- or tool-level: Motion/Runneth on Meta, AppsFlyer on app ads, and Optimizely and Analytics-Toolkit on websites. Seller-level cases (BookBub covers, PickFu, Intelligems price tests) are small or vendor-curated and favour wins. I found no YouTube creator publishing Test & Compare numbers, and no rigorous Etsy or Gumroad experiment.

### Cited Findings
**Book covers (KDP and indie)**
- [MEASURED small, updated 15 Aug 2024] BookBub Ads cover tests by author Tricia O'Malley, CPM bidding, $320 in total:

| Round | Budget | Impressions per variant | Result |
|---|---|---|---|
| 1 | $40 | ~6,000 each | 2.94% vs 2.97% CTR |
| 2 | $80 | ~8,000 vs ~12,000 needed for equal clicks | Original won |
| 3 | $40 | 5,684 vs 6,964 | 2.85% (162 clicks) vs 3.12% (217 clicks) |
| 4 | $120 | not stated | Large typography won at 5.2% |
| 5 | $40 | 2,200 each | Second book 0.58% vs 1.21% |

  - Afterwards, free downloads of the permafree first book rose 40% versus the weeks before. Series sales rose "across all vendors", with no figures given. — [BookBub Insights](https://insights.bookbub.com/boosted-series-sales-testing-cover-designs/)
- [ANECDOTE, OLD ~2014] Derek Murphy's cover redesigns, compared on sales the month before and after:
  - Martin Lake's series: 15 to 54 a month after the first new cover, then 96 once all three matched.
  - Robert Reade: 30 to 58.
  - Luke Young: 4 to 286 copies in 7 days, but confounded by a BookBub promotion of about 40,000 downloads.
  - Three authors reported no data, and Murphy states there were no controls. — [Creativindie](https://www.creativindie.com/can-a-new-book-cover-double-sales-a-case-study-with-10-authors/)
- [VENDOR CLAIM] PickFu customer stories:
  - Amazon seller Brain Juice: +35.2% sales (more than $2,600 extra). — [CaseStudies.com](https://www.casestudies.com/company/pickfu/case-study/one-secret-to-my-success-in-selling-on-amazon)
  - A book title change "impacted performance by 400%", and 76% preferred one cover. — [PickFu on Medium](https://medium.com/pickfu/how-a-book-title-impacted-performance-by-400-dccebe3c091f)
  - No control groups in either.

**Amazon listings**
- [PLATFORM CLAIM] Optimized content gives "up to 20%" more sales (internal data), and one brand reports +8% from changing one word. — [Amazon](https://sell.amazon.com/tools/manage-your-experiments)

**Price tests (Shopify DTC, applicable to digital products)**
- [VENDOR CLAIM] Intelligems customer results:
  - Dossier: +7.4% profit per visitor sitewide. — [Intelligems](https://www.intelligems.io/resources/customer-stories/how-dossier-used-intelligems-to-increase-profit-per-visitor-7-4-sitewide)
  - Beards & Daisies: +8.25% profit per visitor when matching competitor prices lower. — [Intelligems](https://www.intelligems.io/resources/customer-stories/how-beards-daisies-increased-revenue-per-visitor-by-10-with-intelligems)
  - Mott & Bow: +5% profit per visitor. — [Intelligems](https://www.intelligems.io/resources/customer-stories/how-mott-bow-boosted-incremental-profit-30-with-intelligems)
  - Original Grain: top products about 40% more profitable. — [Intelligems](https://www.intelligems.io/resources/customer-stories/how-original-grain-made-top-products-40-more-profitable-with-intelligems)
  - OpenStore: +13% profit. — [CaseStudies.com](https://www.casestudies.com/company/intelligems/case-study/how-openstore-leverages-intelligems-to-boost-profits-by-13-through-taking-a-scientific-approach-to-price-testing-2)
  - In a story titled "testing reduced product prices versus discounts", the lower-price group improved conversion and revenue per visitor by more than 2x. What exactly it was compared against was not verified. — [Intelligems](https://www.intelligems.io/resources/customer-stories/testing-reduced-product-prices-versus-discounts)

**Gumroad**
- [OBSERVATIONAL] Across Gumroad software listings, $200+ products averaged 19.2 units sold versus 5.4 for $1-49 products. This is a cross-product correlation, not a test. — [DEV / InsightRaider](https://dev.to/insightraider/raise-the-price-sell-less-is-backwards-200-gumroad-products-sell-36x-more-units-than-49-45bk)

**YouTube**
- [ANECDOTE] One thumbnail test gave 55.7% more clicks, and another an 8% better result. — [Primal Video](https://primalvideo.com/guides/youtube-thumbnail-design-strategy/)
- [OFFICIAL] YouTube publishes the mechanics but no outcome statistics. — [YouTube Help](https://support.google.com/youtube/answer/13861714)

**Etsy**
- [PRESS, OLD 2023] Etsy itself altered which image appears as the search thumbnail for some listings, with no official explanation. — [Value Added Resource](https://www.valueaddedresource.net/etsy-scrambles-thumbnails-in-search/)

**DTC creative testing frameworks and datasets**
- [OBSERVATIONAL, 2025-26] Motion/Runneth: 578,750 creatives, about 5% winners, creatives per week by spend tier as in Q3. — [Runneth](https://runneth.com/library/research/creative-benchmarks-2026/winners-are-rare)
- [OBSERVATIONAL, 2025] AppsFlyer: 2,365 variations per quarter for high-spending non-gaming apps. — [AppsFlyer](https://www.appsflyer.com/company/newsroom/pr/ai-emotion-creative-trends/)
- [ANECDOTE, Oct 2025] Jon Loomer's Meta Creative Test:
  - 5 ads at $50/day optimizing for registrations, with an expected cost of $3-5 per result. The test ended early.
  - A Flexible Format image ad clearly won, and a two-card carousel came last. The video version cost about $1 more per registration. — [Jon Loomer](https://www.jonloomer.com/meta-creative-testing/)
- [OPINION] The "3-2-2" dynamic-creative structure (12 combinations) is now described by its originator as insufficient after Andromeda (unverified quote). — [AdAdvisor](https://adadvisor.ai/docs/skills/adadvisor-creative)

**Experimentation-program benchmarks (web pages)**
- [MEASURED] Optimizely: 12% win rate, 0.4% average revenue lift, 34 experiments a year at the median company, and bandits beating an even split 63.9% of the time with 3+ variations. — [Optimizely](https://www.optimizely.com/insights/top-10-takeaways-from-the-experimentation-playbook/); [Optimizely 173k](https://www.optimizely.com/field-notes/guides/173000-experiments)
- [MEASURED] Analytics-Toolkit: median 30 days, 60k users per test, 33.5% significant winners. — [Analytics-Toolkit](https://blog.analytics-toolkit.com/2022/what-can-be-learned-from-1001-a-b-tests/)
- [MEASURED] KDD 2026 replications: 2 of 8 published patterns replicated. — [Vermeer, Kohavi et al.](https://www.lukasvermeer.nl/publications/paper/2026/09/02/trustworthy-ab-patterns-and-the-winners-curse.html)
- [MEASURED, OLD 2017] Airbnb: summed wins of 7.2% versus a 4% holdout. — [Airbnb](https://medium.com/airbnb-engineering/selection-bias-in-online-experimentation-c3d67795cceb)

### Inferences
- The case studies that publish big numbers (+35%, +40%, +400%, sales tripling) are vendor-curated or uncontrolled before/after comparisons. The controlled ones (the BookBub rounds) show a mix of nulls, a non-significant "win" and one borderline doubling of CTR. That mix is the realistic distribution an agent should simulate.
- For a learning agency, the most transferable "frameworks" with numbers are:
  - Volume × hit rate (Motion): about 20 creatives per winner.
  - Limited exploration budget (Meta's at most 20%).
  - Profit-per-visitor price tests (Intelligems): ±5-10% steps over 2-3 weeks.
  - Platform-native split tools for visuals: YouTube up to 2 weeks, Amazon 4-10 weeks.
  - Library logging of all outcomes, losers included.
- **Proving that the agents improve over time** should use the program-level metric (share of tests with a confirmed winner, and cumulative shrunken lift), not individual headline wins. Base rates say 12-33% of tests win, so a claimed 90% win rate signals flawed testing.

### Gaps
- No YouTube creator or channel network published Test & Compare outcome numbers that I could find, and YouTube publishes none.
- No rigorous Etsy seller experiment with numbers (first photo, mockup style, video) was found. Vendor blog figures, such as conversion going from 1.8% to 3.4% after one photo change, lacked sample sizes and are omitted.
- No 2024-2026 KDP-specific controlled cover study was found. KDP has no native split, so authors rely on ad-CTR proxies (BookBub, Amazon Ads) or before/after comparisons.
- Gumroad "pay what you want" and price-raise anecdotes found in blogs had no verifiable figures and are omitted.
