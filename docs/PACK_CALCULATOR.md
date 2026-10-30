# Pack Calculator — Step 0.5

Updated: 2026-10-13. Source: [SRS Section 9.4](../srs/SRS_v2.1_AI_Workspace.md). This is an offline planning tool; it does not activate providers, sell packs, access credentials or make network calls.

## Run it

From `D:\free_ai`, using the existing Python 3.11 runtime:

```powershell
python -B tools/pack_calculator.py --examples
python -B tools/pack_calculator.py --research
python -B -m unittest discover -s tests/unit -p test_pack_calculator.py -v
```

`--examples` reads [the labeled hypothetical fixtures](pack_calculator_inputs.json). No prices, model names, rounding quanta, splits or safety factors are embedded in calculator code. Change fixture values to explore hypothetical scenarios, then rerun. These examples are not current market quotes or proposed commercial offers.

`--research` audits the selected records in [pricing_inputs.json](pricing_inputs.json). It returns exit **3** with explicit blockers and null token/cost caps for the existing unresolved model eligibility, settlement FX, gateway fees and all-in costs. This mode is an evidence audit, not a sourced pack generator; final cost inclusion, approval and allowance reachability belong to Phase 6. It does not refresh public pages or change dated research records.

For one custom scenario, copy one complete object from the fixture's `examples` array into a UTF-8 JSON file, then run:

```powershell
python -B tools/pack_calculator.py --config path/to/scenario.json
```

Custom mode must remain `hypothetical` for arithmetic. A `sourced` object uses the evidence-audit path, optionally with `--pricing-inputs path/to/pricing_inputs.json`. Exit **0** means the hypothetical arithmetic succeeded; **2** means invalid/infeasible input; **3** means missing values/evidence. No exit code approves pack sales, and every result has `pack_sales_ready=false`.

## Inputs and units

| Input | Representation / rule |
|---|---|
| `schema_version`, `mode`, `currency` | `1`, `hypothetical`, `BDT` |
| `price_minor`, `hosting_share_minor` | Integer BDT minor units, 100 per BDT; positive price and nonnegative hosting |
| `fee` | Nonnegative integer `fixed_minor`/`minimum_minor`, decimal-string `percentage_rate`, explicit `rounding: ceil_minor` |
| `buffer_pct` | Decimal string in [0,1); share of selling price |
| `input_share`, `output_share` | Decimal strings in [0,1], summing exactly to 1 |
| `safety_factor` | Decimal string greater than 0 and at most 1 |
| `rounding_quantum`, `minimum_useful_tokens` | Positive integers; fixtures use the SRS class quanta and 150,000 minimum |
| `tool_budget_micro_cu` | Nonnegative integer permitted tool-cost bound; 10,000 micro-CU = 1 BDT |
| `model_rates` | Nonempty array of named `id`, `input_bdt_per_1m`, `output_bdt_per_1m`; rates are finite nonnegative decimal strings per million billable tokens |

Decimal inputs use plain strings such as `"0.85"`, up to 128 characters; scientific notation, underscores, JSON floating-point values, duplicate keys, NaN and infinity are rejected. Null required amounts or rates are TODO-VERIFY, never zero. A zero blended model cost cannot turn free-tier quota into unlimited pack tokens. Hypothetical BDT rates must include all intended acquisition/conversion assumptions for the scenario; the tool does not supply real FX or platform/tax fees.

## Calculation and results

The fee fixture computes `ceil(max(fixed_minor + price_minor * percentage_rate, minimum_minor))`; this rounding is a declared hypothetical choice, not a claim about a merchant contract. Buffer is `price * buffer_pct`. AI budget is price minus fee, hosting and buffer.

The calculator uses the greatest input rate and greatest output rate separately across the declared model class, then blends those rates using the configured split. Exact rational arithmetic determines raw tokens; raw numerator/denominator is reported without rounding it into an allocation. Tokens round down by quantum, input cap rounds down by share, and output gets the remainder.

It checks both caps at the conservative rates plus permitted tool budget. If needed, it reduces the allocation to the largest funded whole quantum. Positive total cost rounds up once to micro-CU after summing components; cost cap rounds down from AI budget. Invalid budgets or an unfunded quantum are rejected. Results include an input snapshot, caps, cost bounds, reduction flag and a below-minimum-useful-size warning.

| Hypothetical SRS case | Total tokens | Input cap | Output cap | Cost cap, micro-CU | Worst cost, micro-CU | Below 150K? |
|---|---:|---:|---:|---:|---:|---|
| Premium | 65,000 | 55,250 | 9,750 | 405,000 | 312,000 | Yes |
| Everyday | 1,800,000 | 1,530,000 | 270,000 | 405,000 | 313,200 | No |

Both start with hypothetical BDT 50 price, 1.50 fee, 3 hosting, 5 selling-price buffer and 40.50 AI budget. They reproduce the SRS; they do not establish a feasible real pack. Paid funding, duration/RPM/window/concurrency reachability, immutable purchased terms, gateway contracts and rollout approvals remain later Phase 6 work.

## Verification and next step

[Unit checks](../tests/unit/test_pack_calculator.py) cover the two examples, mixed-class worst rates, tool-budget reduction, expensive-output split rounding, one-time micro-CU rounding, fixed/percentage/minimum fees, floor cost caps, invalid/null inputs, price periods, JSON parsing and CLI behavior. No application or live-provider tests are implied.

The [capacity report](CAPACITY.md) still leaves the 100-user pilot unverified; [open questions](OPEN_QUESTIONS.md) preserve pricing/provider/account conditions. The BDT 1,500 hosting ceiling is not a paid-model budget.

Next: **Step 0.6 — license and dependency review**. Phase 0 remains pending; no real pack-sale or provider approval is supplied by this tool.
