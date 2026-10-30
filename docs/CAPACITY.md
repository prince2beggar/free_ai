# Capacity Planning — Step 0.4

Prepared: **2026-10-13** (Asia/Dhaka). Decision/input record: [CAPACITY-001](DECISIONS.md). Requirements: [SRS Section 7.4, QUOTA-06/07 and Section 17.1](../srs/SRS_v2.1_AI_Workspace.md).

**The three scenario calculations are complete; capacity for the 100-user pilot remains unverified.** The two public reference pools yield conditional daily bounds of **120 / 35 / 16 whole active users** for low / medium / high token usage, each at five user requests/day. These are arithmetic projections, not measured service capacity or an approved free pool. Medium and high usage do not cover the target even under these reference assumptions.

All four candidates retain their disabled/HOLD conditions from [the provider matrix](PROVIDER_TERMS_MATRIX.md) and [provider research](provider_research.json). No provider/account has supplied confirmed eligible quotas. The gate currently credits **zero verified eligible providers**; actual supported users are **TODO-VERIFY**, not a measured zero.

## Inputs and evidence classification

- **OWNER INPUT:** 100 daily active free users for the pilot; recompute after results. The owner selected 100 after the initial 50/100 placeholder was clarified.
- **OWNER INPUT:** maximum monthly hosting budget BDT 1,500 (150,000 minor units). This is a ceiling, not purchasing or paid-inference authorization.
- **ASSUMED OWNER INPUT:** five user requests/day; replace with measured pilot usage.
- **SRS DEFAULT:** safety factor 0.8 from QUOTA-06, applied once to each applicable capacity constraint.
- **ASSUMED:** 1.10 provider attempts/user request for retry overhead; each dispatched attempt conservatively uses the full scenario token allowance. This is an average, not a hard retry guarantee.
- **ASSUMED:** 5% of a pool's daily user requests arrive in the busiest minute. Other traffic distribution, streaming latency and concurrency are unmeasured.
- **ASSUMED:** the reference OpenRouter free counter and direct Cloudflare account allowance are independent. Confirm identities, downstream endpoint scope and overlap before aggregation.

Input tokens include system text, history, retrieved context and files, not just the newest message. Output includes any billed reasoning tokens. No caching discount or truncated input is assumed. Regenerations count as new user requests; provider retries consume additional attempts. These are chat-only scenarios, not multi-step agent tasks.

The following JSON is the reproducible planning input set inside this report. Null quotas mean **TODO-VERIFY**, never unlimited. Calculations that omit unknown constraints are explicitly conditional upper bounds and cannot establish eligibility.

```json
{
  "schema_version": 1,
  "researched_at": "2026-10-13",
  "research_only": true,
  "owner_inputs": {
    "target_daily_active_free_users": 100,
    "monthly_hosting_budget_minor": 150000,
    "budget_currency": "BDT",
    "minor_units_per_major": 100,
    "avg_requests_per_user_per_day": 5,
    "avg_requests_status": "ASSUMED_OWNER_INPUT"
  },
  "assumptions": {
    "safety_factor": "0.8",
    "safety_basis": "SRS QUOTA-06 default",
    "attempts_per_user_request": "1.10",
    "retry_status": "ASSUMED",
    "peak_daily_request_fraction_per_minute": "0.05",
    "peak_status": "ASSUMED",
    "independent_reference_pools_status": "ASSUMED_PENDING_ACCOUNT_AND_ENDPOINT_EVIDENCE"
  },
  "reference_pools": [
    {
      "id": "cf-shared-account",
      "provider_id": "cloudflare-workers-ai",
      "model_id": "@cf/meta/llama-3.1-8b-instruct-fp8-fast",
      "daily_neurons": 10000,
      "input_neurons_per_1m": 4119,
      "output_neurons_per_1m": 34868,
      "rpm": 300,
      "tpm": null,
      "daily_requests": null,
      "account_quota_status": "TODO-VERIFY",
      "eligible_for_feasibility": false,
      "source_ids": [
        "CF-PRICE",
        "CF-LIMIT"
      ]
    },
    {
      "id": "or-shared-free-counter",
      "provider_id": "openrouter",
      "model_id": "qwen/qwen3.8-27b:free",
      "daily_requests": 50,
      "rpm": 20,
      "tpm": null,
      "daily_tokens": null,
      "account_quota_status": "TODO-VERIFY",
      "eligible_for_feasibility": false,
      "source_ids": [
        "OR-PRICE",
        "OR-GUIDE",
        "OR-LIMIT"
      ]
    }
  ],
  "excluded_pools": [
    {
      "id": "groq-diagnostic-only",
      "provider_id": "groqcloud",
      "model_id": "openai/gpt-oss-20b",
      "summary_rpm": 30,
      "summary_tpm": 8000,
      "summary_daily_requests": 1000,
      "summary_daily_tokens": 200000,
      "free_tier_status": "TODO-VERIFY_AMBIGUOUS_PUBLIC_SUMMARY",
      "account_quota_status": "TODO-VERIFY",
      "eligible_for_feasibility": false,
      "source_ids": [
        "GROQ-LIMIT"
      ]
    },
    {
      "id": "gemini-unquantified",
      "provider_id": "gemini-developer-api",
      "model_id": "gemini-3.8-flash",
      "rpm": null,
      "tpm": null,
      "daily_requests": null,
      "daily_tokens": null,
      "account_quota_status": "TODO-VERIFY",
      "eligible_for_feasibility": false,
      "source_ids": [
        "GEMINI-LIMIT"
      ]
    }
  ],
  "alternate_cloudflare_model": {
    "model_id": "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    "input_neurons_per_1m": 26668,
    "output_neurons_per_1m": 204805,
    "pool_id": "cf-shared-account",
    "source_ids": [
      "CF-PRICE"
    ],
    "eligible_for_feasibility": false
  },
  "scenarios": [
    {
      "name": "Low",
      "input_tokens_per_attempt": 1000,
      "output_tokens_per_attempt": 250
    },
    {
      "name": "Medium",
      "input_tokens_per_attempt": 4000,
      "output_tokens_per_attempt": 1000
    },
    {
      "name": "High",
      "input_tokens_per_attempt": 12000,
      "output_tokens_per_attempt": 3000
    }
  ],
  "fx_observations": [
    {
      "id": "bb-war",
      "bdt_per_usd": "123.2800",
      "rate_type": "interbank_reference",
      "effective_at": "2026-10-12",
      "read_at": "2026-10-13",
      "source_ids": [
        "FX-BB"
      ]
    },
    {
      "id": "ebl-card",
      "bdt_per_usd": "124.00",
      "rate_type": "card_payment_reference",
      "effective_at": "2026-10-12",
      "read_at": "2026-10-13",
      "source_ids": [
        "FX-EBL"
      ]
    }
  ],
  "actual_provider_settlement_fx": null,
  "actual_fx_status": "TODO-VERIFY",
  "october_13_effective_fx_status": "TODO-VERIFY_NOT_FOUND_IN_RETRIEVED_SOURCES",
  "gate": {
    "verified_eligible_provider_count": 0,
    "verified_supported_active_users": null,
    "target_support_verified": false,
    "hosting_plan_fits_budget": null,
    "phase_0_go_supported": false
  }
}
```

## Public quota references and pool ownership

| Candidate/pool | Public observation read 2026-10-13 | Use in this report | Account evidence / reset |
|---|---|---|---|
| Cloudflare shared account | 10,000 Neurons/day; text generation 300 RPM. The 8B reference meter uses 4,119 input and 34,868 output Neurons per million tokens [CF-PRICE][CF-LIMIT] | One shared pool; 8B only in the main table. Free/model/plan eligibility and extra constraints remain unconfirmed | Actual account counters and other usage TODO-VERIFY; published daily reset 00:00 UTC |
| OpenRouter shared free counter | Free pricing lists 50 requests/day; official guide gives 20 RPM [OR-PRICE][OR-GUIDE] | One counter across free routes; request-limit bound only. TPM/TPD and chosen endpoint remain unknown | Account policy/exemptions, remaining quota, reset and Free/prepaid conflict TODO-VERIFY [OR-LIMIT] |
| Groq organization/model | Summary shows 30 RPM, 8,000 TPM, 1,000 RPD and 200,000 TPD for GPT OSS; nearby Developer wording and Free/Developer tabs leave tier ambiguity [GROQ-LIMIT] | Diagnostic only; excluded from the reference total until the Free account/model limits are confirmed | Organization scope; separate input/output caps may apply. Exact counters/reset TODO-VERIFY |
| Gemini project/model | Numeric active limits depend on the actual project/tier/model [GEMINI-LIMIT] | Unquantified and excluded; no invented free limits | Project scope, not per key; published RPD reset is midnight Pacific time; actual account limits TODO-VERIFY |

Public values were re-read; this does not turn them into dashboard evidence. Other workloads, administrative probes and failed attempts can reduce the same remaining pool. Each physical quota is counted once across models, users and keys. Do not multiply quota by key/model count or create accounts to evade limits.

## Formula and rounding

For a known combined daily token cap, divide by `T = input + output`. For an input-only cap, divide by input; for an output-only cap, divide by output. Preserve split limits instead of adding unlike counters. Cloudflare's weighted meter is:

```text
neurons_per_attempt = (input_tokens * input_neurons_per_1m
                    + output_tokens * output_neurons_per_1m) / 1,000,000

raw_attempt_bound = min(each known daily request cap,
                        each applicable daily token cap / its corresponding tokens,
                        daily_neurons / neurons_per_attempt)
safe_attempt_bound = floor(raw_attempt_bound * 0.8)
user_request_bound = floor(safe_attempt_bound / 1.10)
daily_user_request_bound = sum(user_request_bound for independent reference pools)
whole_active_user_bound = floor(daily_user_request_bound / 5)

safe_peak_attempts_per_minute = floor(0.8 * min(known RPM,
                                               applicable TPM / corresponding tokens))
assumed_peak_attempts = ceil(user_request_bound * 0.05 * 1.10)
```

The SRS daily formula sums independently eligible pools; this report keeps the arithmetic sum **conditional** because eligibility is unresolved. Unknown required limits stop a verified result. Request-only conversion never proves token throughput. Fractional users are rounded down, separately from per-pool request rounding.

Cloudflare token price equivalents are not used to infer its free token capacity; the weighted Neuron meter avoids mixing currency and quota units. No safety factor is reapplied after summing already-safe pool bounds.

## Low, medium and high usage

Five requests/user/day applies to every scenario. The owner's target therefore needs **500 user requests/day**. Each row varies token size, with the same safety and retry assumptions.

| Scenario | Requests/user/day | Input/attempt | Output/attempt | Total tokens/attempt | CF Neurons/attempt |
|---|---:|---:|---:|---:|---:|
| Low | 5 | 1,000 | 250 | 1,250 | 12.836 |
| Medium | 5 | 4,000 | 1,000 | 5,000 | 51.344 |
| High | 5 | 12,000 | 3,000 | 15,000 | 154.032 |

| Scenario | CF safe attempts/day | CF user requests/day | OR safe attempts/day | OR user requests/day | Conditional total requests/day | Conditional whole users/day | Request surplus/(shortfall) vs 100 users |
|---|---:|---:|---:|---:|---:|---:|---:|
| Low | 623 | 566 | 40 | 36 | 602 | 120 | +102 |
| Medium | 155 | 140 | 40 | 36 | 176 | 35 | -324 |
| High | 51 | 46 | 40 | 36 | 82 | 16 | -418 |

For example, medium Cloudflare capacity is `floor((10000 / 51.344) * 0.8) = 155` attempts; `floor(155 / 1.10) = 140` user requests. OpenRouter gives `floor(50 * 0.8) = 40` attempts and `floor(40 / 1.10) = 36` user requests. Thus `floor((140 + 36) / 5) = 35` whole users.

The low row conditionally covers 100 users. Medium/high are short under this mix; adding an unconfirmed provider, spending hosting funds on inference, or silently lowering the target cannot close that gap. Actual model quality/privacy fit may require another model mix and a full recalculation.

## Peak-minute screening and omitted constraints

| Scenario | Assumed CF peak attempts/min at its daily bound | CF safe RPM portion | Assumed OR peak attempts/min | OR safe RPM portion |
|---|---:|---:|---:|---:|
| Low | 32 | 240 | 2 | 16 |
| Medium | 8 | 240 | 2 | 16 |
| High | 3 | 240 | 2 | 16 |

These fit only the documented RPM portions of the assumed pools. Unknown TPM, split input/output limits, concurrency, per-request bounds, queueing, service latency and downstream restrictions can reduce these bounds. Peak retry traffic may also exceed the assumed daily average. Validate them before describing the pilot as supported.

Groq illustrates why daily arithmetic alone is insufficient. Using its ambiguous summary strictly as a diagnostic, combined TPM leaves `floor(6400 / T)` safe whole attempts per minute. Under the same 5% peak and 1.10 retry assumptions:

| Scenario | Diagnostic daily user requests | Safe whole attempts/min | Peak-limited user requests/day | Diagnostic whole users/day at 5 requests |
|---|---:|---:|---:|---:|
| Low | 116 | 5 | 90 | 18 |
| Medium | 29 | 1 | 18 | 3 |
| High | 9 | 0 | 0 | 0 |

High input alone is 12,000 tokens, above the diagnostic 8,000 TPM limit. The zero is a conservative whole-request screen for that fixture, not evidence that the actual Groq account has zero capacity. Free-tier access, actual token accounting and streaming windows remain unverified; none of this diagnostic is added to the main pool.

## Shared-model, retry and outage sensitivity

Replacing the 8B route with `@cf/meta/llama-3.3-70b-instruct-fp8-fast` changes the same account meter to 26,668 input / 204,805 output Neurons per million tokens [CF-PRICE]. It does not create a second 10,000-Neuron grant.

| Scenario | 70B Neurons/attempt | CF safe attempts/day | CF user requests/day | OR user requests/day | Conditional whole users/day |
|---|---:|---:|---:|---:|---:|
| Low | 77.86925 | 102 | 92 | 36 | 25 |
| Medium | 311.477 | 25 | 22 | 36 | 11 |
| High | 934.431 | 8 | 7 | 36 | 8 |

If every request needs one full-size retry, use amplification **2.0** instead of 1.10. The main 8B/OR reference then yields **66 / 19 / 9** whole users. The low case also falls below the 100-user target. Expected retries must therefore be measured; the Governor reserves every attempt and fails closed on exhausted quota.

If either main reference pool disappears, the smaller surviving daily bound is 36 user requests, or **7 whole users** at five requests each in every scenario. This is not an outage promise; it shows the reference mix lacks capacity to preserve the 100-user allowance during a pool loss. A fallback also needs its own eligibility, privacy, quality and capacity evidence.

Resets use each provider's real window/time zone, not assumed Bangladesh midnight. Align the pilot reporting period and preserve reset metadata; do not treat two resets inside one local calendar day as two permanent grants. No quota release is assumed for an uncertain post-dispatch attempt. A quota bound is not guaranteed successful delivery.

## FX and BDT 1,500 hosting ceiling

The current retrieved official pages still display **2026-10-12** effective rates, re-read **2026-10-13**. Bangladesh Bank shows USD/BDT WAR **123.2800** [FX-BB]; EBL shows a card-payment reference of **124.00 BDT/USD** [FX-EBL]. A separate October 13 effective rate was not found in the retrieved sources; freshness is explicitly TODO-VERIFY, not relabeled as an October 13 quote.

For comparison only, `floor((1500 / 124.00) * 100) / 100 = USD 12.09` before fees/taxes. Neither reference selects a payment issuer or verifies actual settlement FX. Existing [Step 0.3 pricing observations](pricing_inputs.json) remain dated and unchanged; FX-SETTLEMENT/PRICE-TAX remain open.

A hosting plan has not been chosen. The all-in monthly ceiling is **BDT 1,500** including the selected app/database/storage/backup/bandwidth/logging plan and relevant charges, with bounded overage. The actual total is TODO-VERIFY for Step 0.7. Free inference does not establish free hosting; this ceiling provides no paid-model funding.

## Gate disposition and next evidence

**Step 0.4 artifact: complete conditional planning. Phase 0 capacity/hosting acceptance: pending.** The owner expressly allowed missing quotas to remain TODO-VERIFY while the three scenarios were computed.

| Gate/input | Finding |
|---|---|
| D2 pilot target | RECORDED: 100 daily active free users |
| D3 budget ceiling | RECORDED: BDT 1,500/month |
| Traffic assumptions | Five requests/user/day supplied as ASSUMED; token sizes, peak and retry rates need measurements |
| Eligible provider/account quotas | TODO-VERIFY; four providers remain disabled/HOLD |
| Pilot supported across scenarios | Not verified; medium/high conditional references fall short |
| Real Bangla/English quality | TODO-VERIFY, Step 0.8; model price or public benchmarks do not prove this |
| Hosting fits D3 without unlimited overage | TODO-VERIFY, Step 0.7 |
| Phase 0 GO / GO_CHAT_ONLY | Not established by this report |

Before a verified capacity result, obtain a dated, credential-free record for each chosen approved account/model: provider/tier/model, quota owner, remaining shared daily request/token/Neuron counters, RPM/TPM and any input/output split, reset metadata, billing/no-overage settings, context/output and concurrency constraints, plus intended-use/model/privacy/region approval. Record other workload reservations and pool overlap. Then recalculate for 100 users and measured traffic; validate with authorized Step 0.8 calls only after the required scope is approved.

Proceed next to **Step 0.5**, the calculator, carrying all pricing and provider unknowns forward. Completing these research artifacts does not close Phase 0 or activate any provider.

## Official sources

All read **2026-10-13**. Numerical observations and clauses are public evidence; account-specific values are unknown.

| ID | Official source | Evidence location |
|---|---|---|
| CF-PRICE | [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/) | Daily allocation/reset and 8B/70B model Neuron rows |
| CF-LIMIT | [Workers AI limits](https://developers.cloudflare.com/workers-ai/platform/limits/) | Text generation default and paid-model exceptions |
| OR-PRICE | [OpenRouter pricing](https://openrouter.ai/pricing/) | Free plan daily requests |
| OR-GUIDE | [OpenRouter official low-cost guide](https://openrouter.ai/blog/tutorials/how-to-get-the-lowest-cost-llm-inference-on-openrouter/) | Free account 20 RPM/50 RPD; failed requests use quota |
| OR-LIMIT | [OpenRouter limits](https://openrouter.ai/docs/api_reference/limits) | Account free counter, policy/exemptions; numeric table extraction incomplete |
| GROQ-LIMIT | [Groq rate limits](https://console.groq.com/docs/rate-limits) | Organization scope, split caps, exact account limits and ambiguous summary |
| GEMINI-LIMIT | [Gemini rate limits](https://ai.google.dev/gemini-api/docs/rate-limits) | Project/model scope, Pacific reset, active AI Studio limits |
| FX-BB | [Bangladesh Bank exchange rate](https://www.bb.org.bd/en/index.php/econdata/exchangerate) | Effective 2026-10-12 USD/BDT WAR |
| FX-EBL | [EBL foreign exchange rates](https://www.ebl.com.bd/forexrate) | As on 2026-10-12, All Card Related Payment |

[CF-PRICE]: https://developers.cloudflare.com/workers-ai/platform/pricing/
[CF-LIMIT]: https://developers.cloudflare.com/workers-ai/platform/limits/
[OR-PRICE]: https://openrouter.ai/pricing/
[OR-GUIDE]: https://openrouter.ai/blog/tutorials/how-to-get-the-lowest-cost-llm-inference-on-openrouter/
[OR-LIMIT]: https://openrouter.ai/docs/api_reference/limits
[GROQ-LIMIT]: https://console.groq.com/docs/rate-limits
[GEMINI-LIMIT]: https://ai.google.dev/gemini-api/docs/rate-limits
[FX-BB]: https://www.bb.org.bd/en/index.php/econdata/exchangerate
[FX-EBL]: https://www.ebl.com.bd/forexrate

