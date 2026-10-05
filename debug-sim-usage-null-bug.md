# Debug Session: sim-usage-null-bug

**Status:** [OPEN]
**Date:** 2026-10-05
**Description:** Per-SIM "Dataverbruik vernieuwen" knop retourneert dataUsedBytes=NULL, smsUsedCount=NULL terwijl dataLimitBytes/product WEL correct zijn.
**Target SIM:** 8988308650120035893

---

## Hypotheses

| # | Hypothesis | Status | Evidence |
|---|------------|--------|----------|
| H1 | `ensureUsageDetailsForSim()` wordt niet aangeroepen | ??? | — |
| H2 | Usage-endpoints retourneren geen data (4xx/5xx/leeg) | ??? | — |
| H3 | Endpoints retourneren data, maar enrichSimhuisStatusWithDirectRawExtracts() extraheert niks | ??? | — |
| H4 | Enrich werkt WEL, maar applyUsageFieldsFromSimhuis past het NIET toe (NON-NULL PRESERVATION / buildUsageFieldsFromSimhuis bug) | ??? | — |
| H5 | Simhuis heeft überhaupt geen usage data voor deze SIM (params verkeerd) | ??? | — |

---

## Steps

1. [ ] Instrument code with trace logs (network report to Debug Server)
2. [ ] Reproduce: click "Dataverbruik vernieuwen" on SIM 8988308650120035893
3. [ ] Analyze pre-fix logs → confirm/reject H1..H5
4. [ ] Apply minimal fix (evidence-based)
5. [ ] Reproduce again → post-fix logs analysis
6. [ ] User verification → compare pre vs post
7. [ ] Cleanup instrumentation + debug artifacts
