# Provider Terms Matrix — Step 0.2

Reviewed: **2026-10-12** (Asia/Dhaka client date). Research artifact status: **COMPLETE; provider selection and activation remain pending**.

Scope: the owner authorized an agent-researched initial shortlist: Google Gemini Developer API, GroqCloud, OpenRouter, and Cloudflare Workers AI. Only public official documentation was read. No accounts, credentials, model requests, payments, or provider settings were used or changed.

`VERIFIED` means the cited public source states the finding; it does not mean an account has that quota or the intended deployment is approved. `CONDITIONAL` marks a documented permission with conditions or an unresolved product fit. `TODO-VERIFY` blocks relying on that fact for a launch or capacity claim. Source identifiers below link to official pages; **every source was read on 2026-10-12**.

## Appendix B comparison

| Field | Google Gemini Developer API | GroqCloud | OpenRouter | Cloudflare Workers AI |
|---|---|---|---|---|
| Name and plan/tier reviewed | Gemini API unpaid/free tier; paid terms compared for privacy [G1][G3] | Free tier; Developer billing/limits compared [Q1][Q5][Q7] | Free plan and free-model variants; Standard compared [O1][O2] | Workers Free with Workers AI; Paid overage compared [C1][C3] |
| Terms URL and version/date | [Additional terms][G1]: effective 2026-03-23; also [Google API terms][G2]. Read 2026-10-12 | [Services Agreement][Q1]: modified 2026-06-22. Read 2026-10-12 | [Terms][O1]: updated 2026-08-31. Read 2026-10-12 | [Self-Serve Agreement][C1]: updated 2025-09-12; [Developer Platform terms][C2]: updated 2026-09-28. Read 2026-10-12 |
| Public multi-user serving allowed? Clause location | CONDITIONAL: API-client framework in G2 §3; G2 §4(a)(1) prohibits API-equivalent sublicensing. G1 Use Restrictions adds product-fit conditions. TODO-VERIFY: this workspace's intended use [G1][G2] | CONDITIONAL: Q1 §3.1 expressly covers customer applications and end users; §6.3(c),(e) restrict resale/competing offerings. TODO-VERIFY: intended aggregator/paid-pack fit [Q1] | CONDITIONAL: O1 §5.1–5.2 recognizes customers of integrated products; §7(4) restricts API resale and competing services. TODO-VERIFY: intended aggregator fit or written exception [O1] | CONDITIONAL: C2 Developer Platform §3 discusses end users; C1 §2.2.1(a) restricts selling service access. TODO-VERIFY: derived workspace use under applicable agreement [C1][C2] |
| Commercial use allowed? | CONDITIONAL: G1 addresses professional/business development; API resale restrictions still apply. No blanket approval for this app [G1][G2] | CONDITIONAL: application rights exist; resale and competition restrictions still apply. Third-party model terms must pass [Q1] | CONDITIONAL: integrated-product customers are contemplated, but resale/competition and model terms constrain use [O1] | CONDITIONAL: customer content/apps contemplated; resale limits and each model license still require review [C1][C2] |
| Prompts used for training or human review? | VERIFIED unpaid policy: `may_train`; submitted content/output may improve models and be human-reviewed. Paid policy differs; do not send sensitive data on unpaid routes [G1] | VERIFIED default policy: `no_training` absent explicit customer permission, Q1 §4.2. Retention can occur for reliability/abuse up to 30 days; ZDR controls documented [Q1][Q3] | `unknown` for an unselected route: downstream policies vary. OpenRouter's own prompt retention is generally opt-in; enabled logging adds permissions. No blanket private-mode approval [O1][O5][O6] | VERIFIED default policy: `no_training` absent explicit consent. Linked storage services can store content; model-specific terms remain applicable [C2][C5] |
| Region restrictions | Bangladesh is on the availability list. G1 requires paid service for EEA/Switzerland/UK end users. D10 country plan still TODO-VERIFY [G1][G5] | Export-control obligations apply; no Bangladesh-specific eligibility confirmation obtained. D10 and actual account availability TODO-VERIFY [Q1] | Model/provider-specific restrictions apply; O1 §5.7 bars circumvention. Bangladesh/model combination and D10 TODO-VERIFY [O1] | C1 §7.1 covers sanctions/export restrictions. No Bangladesh-specific account/model confirmation obtained; D10 TODO-VERIFY [C1] |
| Free limits: minute/day/tokens, date checked | Per-project RPM/input TPM/RPD; keys do not create new pools. RPD reset: Pacific midnight. Exact numeric free limits require the selected project's AI Studio view: TODO-VERIFY. Checked 2026-10-12 [G4] | Organization-scoped limits. Published gpt-oss-20b/120b summary: 30 RPM, 1,000 RPD, 8,000 TPM, 200,000 TPD. Free/Developer tabs and exceptions require exact free-org confirmation: TODO-VERIFY. Checked 2026-10-12 [Q2] | Current Free pricing lists 50 requests/day. Official guide lists 20 RPM; limits docs tie daily ceilings to purchase history. Exact account ceilings/reset/token limits: TODO-VERIFY. Checked 2026-10-12 [O2][O3][O4] | 10,000 Neurons/day; reset 00:00 UTC; default text-generation ceiling 300 RPM, excluding paid-required models. Tokens/day depend on selected model's neuron rates: TODO-VERIFY. Checked 2026-10-12 [C3][C4] |
| Shared-pool ownership | Project/model limits; all keys within a project share applicable counters. Billing caps also aggregate at billing account level [G4][G6] | Organization-level, with model-specific bounds; all customer traffic shares the relevant org counters [Q2][Q4] | Account/key metadata exposes the free-model daily counter; do not multiply the allowance by model count or additional personal accounts. Actual scope/exemptions TODO-VERIFY [O1][O3] | Treat daily Neuron allocation as one shared account budget, not one grant per user/model; confirm account counters before capacity math [C3][C4] |
| Tool calling supported? | VERIFIED documentation describes function calling. Exact chosen free model and runtime behavior TODO-VERIFY [G7] | VERIFIED Q6 lists local tools for gpt-oss-20b/120b; both are listed without parallel tool support. Actual chosen free-org route and reliability TODO-VERIFY [Q6][Q7] | VERIFIED interface supports tools on selected supported models; not every free route qualifies. Current endpoint, model terms, and reliability TODO-VERIFY [O7] | VERIFIED function-calling feature is documented as beta/model-specific. One documented example model link redirects as unavailable: select a current catalog model instead [C6][C7] |
| Bangla quality score | TODO-VERIFY — real evaluation Step 0.8; no score fabricated | TODO-VERIFY — real evaluation Step 0.8; no score fabricated | TODO-VERIFY — real evaluation Step 0.8; no score fabricated | TODO-VERIFY — real evaluation Step 0.8; no score fabricated |
| Coding evaluation score | TODO-VERIFY — Step 0.8; `agent_ready=false` until passed | TODO-VERIFY — Step 0.8; `agent_ready=false` until passed | TODO-VERIFY — Step 0.8; `agent_ready=false` until passed | TODO-VERIFY — Step 0.8; `agent_ready=false` until passed |
| Hard spend cap available? | Paid project caps documented with roughly 10-minute latency/possible overage; cannot be the sole hard safety mechanism. Keep free project unlinked from billing; actual configuration TODO-VERIFY [G6] | Paid org caps block after spend updates but may overshoot during 10–15-minute tracking delay. Free-tier/account settings TODO-VERIFY; keep app-side reservations [Q4][Q5] | Free pricing lists no budget/spend controls; paid controls documented. Auto-recharge must remain off. Free-only/no-overage account behavior TODO-VERIFY [O1][O2][O3] | Workers Free daily ceiling refuses further operations; Workers Paid bills overage. Exclude paid-required models and automatic paid upgrades; actual plan/counters TODO-VERIFY [C3][C4] |
| Decision: enable / private-only / reject | **HOLD** pending product/audience/region fit and owner review; unpaid route excluded from private mode | **HOLD** pending app/resale/competition fit, model terms, exact account limits, and owner review | **HOLD** pending resale/competition clarification, free-tier contradictions, endpoint privacy, and owner review | **HOLD** pending intended-use permission, selected model license/capacity, and owner review |

HOLD is a research disposition, not a production decision. All candidates remain disabled. In the companion record, `allows_multiuser=false` means the intended-use approval gate is unresolved; it does not erase the conditional application rights documented above. No candidate currently supplies a completed two-provider GO gate.

## Specific findings to resolve before relying on the shortlist

1. **Gemini audience and product fit:** G1 Age Requirements excludes API clients aimed at, or likely reached by, under-18 users; Use Restrictions raises a consumer-use fit question. Define the intended audience (including age) and obtain applicable fit confirmation. Do not treat a student offer as proof of eligibility. Unpaid training/review and European paid-only requirements must shape routing. [G1]
2. **Groq application fit:** the end-user grant and resale/competition restrictions must be read together for this workspace. Confirm the intended application rather than equating API integration with unrestricted redistribution. Its no-training promise is separate from ZDR/retention settings. [Q1][Q3]
3. **OpenRouter conflicting/conditional evidence:** O1 §4.1 describes prepaid credits for API access, while O2 advertises a Free API plan. O4 says a deposit does not expire, whereas O1 §4.2 allows unused purchased credits to expire after a year. O2 lists no Free data-policy routing, while O5 describes separate free/paid training-routing controls. Obtain current tier/account clarification; favor contractual restrictions and actual supported controls, never a blog promise. [O1][O2][O4][O5]
4. **Cloudflare actual model selection:** Neurons cannot be converted into user tokens without model-specific input/output rates. C6's example is not proof that its model remains available: C7 redirects to the catalog with an unavailable marker. Confirm current free eligibility, model license, and tools before using it as an agent candidate. [C3][C6][C7]
5. **No quota evasion:** public limits are shared infrastructure budgets. Do not rotate keys/accounts to manufacture capacity. REG-05 remains mandatory. D2/D3 are inputs for later capacity/hosting work; their absence did not prevent this authorized public-source review.

## Registry and approval gates

- Keep `enabled=false`, `owner_approved=false`, `allows_multiuser=false`, `actual_quotas_confirmed=false`, and `agent_ready=false` for these research records until the corresponding evidence and authorization exist.
- Separate a documented data-policy promise from proof of an account's settings. `no_training` does not mean no retention, no processing abroad, or unlimited private capacity.
- Downstream model licenses, region/audience policy, no-overage billing controls, and the chosen tier must be reviewed before setting a usable registry record.
- Before any real model evaluation or provider/key use, obtain the scoped authorization required by SRS P4. External support contact is not authorized by this research task; record needed confirmations without sending messages.
- Step 0.2 can be technically DONE because every Appendix B cell is sourced or flagged. Phase 0 remains open, and none of its GO conditions are asserted by this artifact.

## Official source register

All entries read **2026-10-12**. Terms section numbers/headings above are the evidence locations. Pricing/rate pages are dated research references, not constants embedded into product code. Groq's former pricing URL redirected to its homepage; use the model/billing documentation below rather than claiming that redirect supplied price evidence. OpenRouter's rate-limit table partly omitted numeric markup in the browser extraction; current pricing plus its official guide supplied the published reference figures, with actual account values still unresolved.

| ID | Official source | Relevant location |
|---|---|---|
| G1 | [Gemini additional terms](https://ai.google.dev/gemini-api/terms) | Age, use restrictions, unpaid/paid data handling |
| G2 | [Google API terms](https://developers.google.com/terms) | §2(d), §3, §4(a)(1) |
| G3 | [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing) | Free/Paid comparison; selected models must be rechecked |
| G4 | [Gemini rate limits](https://ai.google.dev/gemini-api/docs/rate-limits) | Project scope, reset, active limits |
| G5 | [Gemini available regions](https://ai.google.dev/gemini-api/docs/available-regions) | Country list, including Bangladesh |
| G6 | [Gemini billing](https://ai.google.dev/gemini-api/docs/billing) | Spend caps, latency, project/key inheritance |
| G7 | [Gemini function calling](https://ai.google.dev/gemini-api/docs/function-calling) | Feature documentation; no live validation |
| Q1 | [Groq Services Agreement](https://console.groq.com/docs/legal/services-agreement) | §2, §3.1–3.2, §4.1–4.2, §5.1, §6.3 |
| Q2 | [Groq rate limits](https://console.groq.com/docs/rate-limits) | Organization scope, public summary, exact Console limits |
| Q3 | [Groq customer data](https://console.groq.com/docs/your-data) | Retention, reliability/abuse exceptions, ZDR |
| Q4 | [Groq spend limits](https://console.groq.com/docs/spend-limits) | Paid org cap; 10–15-minute delay |
| Q5 | [Groq billing FAQs](https://console.groq.com/docs/billing-faqs) | Free/Developer upgrade/downgrade and billing |
| Q6 | [Groq tools](https://console.groq.com/docs/tool-use/overview) | Supported models table |
| Q7 | [Groq models and pricing](https://console.groq.com/docs/models) | Production models; paid-price table |
| O1 | [OpenRouter terms](https://openrouter.ai/terms/) | §2, §4.1–4.2, §5.1–5.7, §6, §7(3)–(4) |
| O2 | [OpenRouter pricing](https://openrouter.ai/pricing/) | Free plan limits and unavailable controls |
| O3 | [OpenRouter limits](https://openrouter.ai/docs/api_reference/limits) | Budgets, free-model counter, tier policy |
| O4 | [OpenRouter official low-cost guide](https://openrouter.ai/blog/tutorials/how-to-get-the-lowest-cost-llm-inference-on-openrouter/) | Free account RPM/RPD and deposit claims |
| O5 | [OpenRouter provider logging](https://openrouter.ai/docs/guides/privacy/provider-logging) | Training policy, separate free/paid settings |
| O6 | [OpenRouter data collection](https://openrouter.ai/docs/guides/privacy/data-collection) | Opt-ins, anonymous categorization, metadata |
| O7 | [OpenRouter tools](https://openrouter.ai/docs/guides/features/tool-calling) | Supported models filter and interface |
| C1 | [Cloudflare Self-Serve Agreement](https://www.cloudflare.com/terms/) | §2.2.1(a),(c), §7.1 |
| C2 | [Cloudflare Developer Platform terms](https://www.cloudflare.com/service-specific-terms-developer-platform/) | Developer Platform §3; Workers AI/AI Gateway §1–3 |
| C3 | [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/) | Daily Neuron allocation/reset; Free/Paid distinction |
| C4 | [Workers AI limits](https://developers.cloudflare.com/workers-ai/platform/limits/) | Text-generation default and paid-model exceptions |
| C5 | [Workers AI data usage](https://developers.cloudflare.com/workers-ai/platform/data-usage/) | Training consent, customer content, storage |
| C6 | [Workers AI function calling](https://developers.cloudflare.com/workers-ai/features/function-calling/) | Beta/model-specific support and example |
| C7 | [Workers AI example model availability](https://developers.cloudflare.com/workers-ai/models/hermes-2-pro-mistral-7b/) | Redirects to model catalog with unavailable marker |

[G1]: https://ai.google.dev/gemini-api/terms
[G2]: https://developers.google.com/terms
[G3]: https://ai.google.dev/gemini-api/docs/pricing
[G4]: https://ai.google.dev/gemini-api/docs/rate-limits
[G5]: https://ai.google.dev/gemini-api/docs/available-regions
[G6]: https://ai.google.dev/gemini-api/docs/billing
[G7]: https://ai.google.dev/gemini-api/docs/function-calling
[Q1]: https://console.groq.com/docs/legal/services-agreement
[Q2]: https://console.groq.com/docs/rate-limits
[Q3]: https://console.groq.com/docs/your-data
[Q4]: https://console.groq.com/docs/spend-limits
[Q5]: https://console.groq.com/docs/billing-faqs
[Q6]: https://console.groq.com/docs/tool-use/overview
[Q7]: https://console.groq.com/docs/models
[O1]: https://openrouter.ai/terms/
[O2]: https://openrouter.ai/pricing/
[O3]: https://openrouter.ai/docs/api_reference/limits
[O4]: https://openrouter.ai/blog/tutorials/how-to-get-the-lowest-cost-llm-inference-on-openrouter/
[O5]: https://openrouter.ai/docs/guides/privacy/provider-logging
[O6]: https://openrouter.ai/docs/guides/privacy/data-collection
[O7]: https://openrouter.ai/docs/guides/features/tool-calling
[C1]: https://www.cloudflare.com/terms/
[C2]: https://www.cloudflare.com/service-specific-terms-developer-platform/
[C3]: https://developers.cloudflare.com/workers-ai/platform/pricing/
[C4]: https://developers.cloudflare.com/workers-ai/platform/limits/
[C5]: https://developers.cloudflare.com/workers-ai/platform/data-usage/
[C6]: https://developers.cloudflare.com/workers-ai/features/function-calling/
[C7]: https://developers.cloudflare.com/workers-ai/models/hermes-2-pro-mistral-7b/
