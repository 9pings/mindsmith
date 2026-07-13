# Mindsmith

[![npm](https://img.shields.io/npm/v/mindsmith?logo=npm&color=cb3837)](https://www.npmjs.com/package/mindsmith)
[![npm downloads](https://img.shields.io/npm/dm/mindsmith?color=cb3837)](https://www.npmjs.com/package/mindsmith)
[![node](https://img.shields.io/node/v/mindsmith)](https://nodejs.org)
[![license](https://img.shields.io/npm/l/mindsmith?color=blue)](./LICENSE)

Built on the [skynet-graph](https://github.com/9pings/skynet-graph) reasoning engine — the substrate + combos this app puts to work.

> **Pre-launch — nothing is field-adopted yet (rung 6/6 is empty on every bar below).**
> We publish maturity per feature and keep refuted claims on the page. Honesty is the product's USP,
> so it is also the documentation's. See [docs/honesty.html](https://9pings.github.io/mindsmith/honesty.html).

**Mindsmith is an external reasoning layer for your local LLM — an auditable critical mind, gated
think-mode lanes, and verified-stock answers at zero frontier calls, from a mixture of certified
graph-experts fronting your model. OpenAI-compatible endpoint + MCP tools over shareable `.sgc` rooms;
nothing leaves your machine by default.**

A small quantized gguf fits your VRAM, but quantization costs it judgment — and on its own it has no
external check on its reasoning. Mindsmith, a thin surface over the
[skynet-graph](https://github.com/9pings/skynet-graph) engine, hands the model tools it doesn't have
alone: answers steered against a certified **method vocabulary** (covered queries served from verified
local stock at 0 frontier calls); gated **assistant lanes** (`propose` / `hint` — an external think-mode
that returns a tested verdict or refuses, never a guess); and an external **critical mind** (`critique` —
weigh a question over a witness-gated pool of arguments, with an honest, certification-aware verdict).
The judgment repair is measured on the same model at two quant levels (protocols in the engine repo):
SQL covered queries low-quant **8→63 %** (high-quant reference 46→92 %, N=201) · finance-table traffic
**7→62 %** (20→78 %, N=120) — zero big-model calls at runtime on the covered slice.

No accounts, no catalog, no phone-home. Stocks live in a local **room** you own: build them with the
engine's forge (0 false admissions across 3 datasets × 2 forge models; sha256 validation dossier per
stock), freeze them, share them as files, import someone else's — a malformed bundle is refused at the
gate, never written.

## 60-second quickstart

```bash
# Install (on npm):  npm i -g mindsmith   (per-project: npm i mindsmith · one-shot: npx mindsmith)
# The demo/test suite lives in the repo — for those, git clone instead (npm is for building an app).

# 1 — serve (embedded gguf as the escalation):
#   the embedded gguf backend needs the local runtime once:  npm install node-llama-cpp  (prebuilt, no compile)
#   on WSL, export this or the gguf silently runs on CPU:
#     export LD_LIBRARY_PATH=/usr/lib/wsl/lib:/usr/lib/x86_64-linux-gnu
FRONTIER_MODEL=/path/model.gguf mindsmith serve --room ./sgc
# → mindsmith → http://127.0.0.1:4747/v1   (OpenAI-compatible)
# (or skip the local runtime and use an endpoint: LLM_BASE=<url> mindsmith serve)

# 2 — point ANY OpenAI client at it (official SDKs, LangChain, Open WebUI, curl):
#    baseURL = http://127.0.0.1:4747/v1     apiKey = anything
curl -si http://127.0.0.1:4747/v1/chat/completions \
  -H 'content-type: application/json' \
  -d '{"messages":[{"role":"user","content":"your question"}]}'
# every completion carries provenance headers:
#   x-sg-served-from: local|frontier · x-sg-arm · x-sg-cost · x-sg-coverage · x-sg-saved · x-sg-sgc-version

# 3 — your stock rooms (local .sgc mini-repos, gate-checked):
mindsmith rooms list                          # inventory: name@version, classes, sha256, ❄ frozen
mindsmith rooms import ./fin-tables-stock.sgc # gate-checked (a bad bundle never lands)
mindsmith rooms freeze fin-tables-stock       # writes the auditable sha256 dossier
mindsmith rooms export fin-tables-stock ./out # bundle + dossier, ready to share

# 4 — or as MCP tools for an agent host (Claude Code, any MCP client):
claude mcp add mindsmith -- mindsmith mcp --routing routing.json
# tools: ask · drift · metrics · lattice_load · hint · propose · critique
```

`GET /healthz` is the ops readout (no key, no query content): policy, configured vs reachable tiers,
loaded `.sgc` versions, stock size.

## Features × maturity

Maturity uses a fixed 6-rung scale — 1 coherent idea · 2 design with pre-registered kill-gates ·
3 mechanics proven · 4 measured at scale · 5 product-integrated · 6 field-adopted. Nothing is at 6:
this is pre-launch. Scale details: [docs/honesty.html](https://9pings.github.io/mindsmith/honesty.html).

| Feature | Maturity | Measured | Docs |
|---|---|---|---|
| **F1 — Low-quant repair** (certified stock steers the model; covered → 0 frontier calls) | `█████░` 5/6 product-integrated | SQL 8→63 % (N=201) · finance tables 7→62 % (N=120) · forge 0 false admissions | [docs](https://9pings.github.io/mindsmith/features.html#f1) |
| **F4 — External think mode** (`propose` → gated verdict + blame + tested options; `hint` menu) | `█████░` 5/6 product-integrated | one dialogue round 17/24 → 24/24 at zero false admissions | [docs](https://9pings.github.io/mindsmith/features.html#f4) |
| **F5 — External critical mind** (`critique`: witness gate, anchored generation, honest verdict) | `█████░` 5/6 surface · campaign numbers at 4/6 | coverage 77 % vs 58 % (48 args) · certified perimeter 12/24 → 24/24 · 0 fabrication in negative controls | [docs](https://9pings.github.io/mindsmith/features.html#f5) |
| **F6 — Local `.sgc` rooms** (list/import/export/freeze, sha256 dossiers, engine-gated loads) | `█████░` 5/6 product-integrated | gate-checked import; loads never bypass the engine gates | [docs](https://9pings.github.io/mindsmith/features.html#f6) |
| **F2 — Piece-by-piece zoom** (typed DAG on big tasks) | `████░░` 4/6 measured — **library-only today, not surfaced here (the known gap)** | math word problems ×3.25 [2.4–4.8] · financial-table QA ×2.54 [1.96–3.5], 560 tasks | [docs](https://9pings.github.io/mindsmith/features.html#f2-gap) |

## Why not just…?

- **…run a bigger model?** If it fits your VRAM, do. This exists for the model you *can* run:
  certified-stock steering recovers most of what quantization broke (SQL 8→63 %, finance 7→62 %),
  at 0 frontier calls on the covered slice.
- **…use the model's think mode / a self-critique prompt?** The 2024-25 literature (and our own
  3-form refutation) agree: self-critique underperforms *external* feedback with localized blame.
  The `propose` gate and `critique` tool are that external feedback — structural, auditable, and
  un-arguable-with (a forced write lands UNTRUSTED, never admitted).
- **…RAG / a prompt library?** Retrieval trusts whatever is indexed. A room only admits what
  passes the gate (0 false admissions measured at the forge), and every completion tells you
  which slice you can trust (`x-sg-served-from`, `x-sg-coverage`).
- **…an agent framework's memory?** None we checked reopens a task whose premise drifted; the
  engine's typed task state retracts and reopens with the reason, at 0 model calls (surfaced here
  via MCP `state_recall` / `plan_sync` on the engine side).

## What actually runs

- **`serve`** — `POST /v1/chat/completions`, `GET /v1/models`, `GET /healthz`. Default port 4747,
  binds 127.0.0.1 on purpose. A covered query is served from verified local stock at 0 frontier calls;
  a miss escalates (you always get an answer); the local side never fabricates — 0 hallucination by
  construction on the covered slice.
- **Escalation** — either a single frontier (`FRONTIER_MODEL=<path.gguf>` embedded, or `LLM_BASE=<url>`
  any OpenAI-compatible endpoint), or **N-tier routing** (`--routing config.json`): ordered tiers, each
  tagged with an egress class (`none` / `mid` / `frontier`), governed by a policy ceiling —
  `no-egress` (default for routing configs) · `allow-mid` · `allow-all`. A query is **never** silently
  sent to a forbidden tier: if the policy leaves nothing reachable, you get a typed `NO_REACHABLE_TIER`
  refusal. The no-egress guarantee is enforced fail-closed on real sockets in the test suite, with a
  negative control proving the guard has teeth.
- **`mcp`** — the same verified stock + escalation over stdio (no HTTP socket). Tools:
  `ask` (local-first, `{answer, source, cached, cost}`) · `drift` (invalidate a stale entry) ·
  `metrics` (economy readout) · `lattice_load` (learn THROUGH the gate — the only registry write path) ·
  `hint` (SOFT lane: advisory certified-shape menu, no guarantee attached) · `propose` (HARD lane: the
  gate never yields; `force=true` records untrusted provenance, never admits) · `critique` (below).
- **`rooms`** — `list | import <file> | export <name> <dest> | freeze <name>`. Import dry-loads the
  bundle through the same gates the appliance uses; freeze writes the sha256 dossier that makes the
  bundle a fixed, auditable reference.

## The `critique` iteration contract

`critique` runs the external critical mind on a question: declared viewpoints established through a
witness gate over a statement pool, anchored generation of missing theses, a typed ledger, and a
certification-aware verdict. The contract: **OPEN ledger points and an UNDECIDED verdict are a typed
data request, not a dead end.** The tool cannot reach the web — the host (you, or your agent) gathers
real statements that bear on the OPEN points, then calls `critique` again with `statements: [...]`
(`"PRO: ..."` / `"CON: ..."` lines). The frame upgrades to MATERIAL and the margin can move honestly.
A verdict is mechanical only at the measured margin bound (≥3 on free/declared frames, ≥2 on a
certified perimeter); below it the deliverable is counts + coverage + an honest UNDECIDED — never a
fake weighing.

## Honest limits (what is NOT claimed)

- **The guarantee is at stock admission, not at execution.** Runtime steering orients; a suggestion is
  not a correctness proof. A runtime "trusted answers" cross-agreement tier was tested and **refuted**
  — it was removed, and stays listed in [docs/honesty.html](https://9pings.github.io/mindsmith/honesty.html).
- **The win lives on the typed, recurrent slice of your traffic.** Coverage depends on your stocks;
  forge yield is per-domain; amortization is a property of the domain's stereotypy.
- **F2 zoom is not surfaced here.** The piece-by-piece decomposition is measured (rung 4/6) but
  library-only in skynet-graph today; no MCP tool exposes it yet.
- **`critique` bounds**: below the measured decidability margin the verdict is UNDECIDED by design;
  entry templates are not yet form-robustness-tested; on FREE frames coverage is relative to the pool
  (the payload says so).
- Streaming is simulated; no per-tier timeout yet.
- **Nothing is field-adopted (rung 6/6)** — no external replications yet. This is pre-launch.

## Env / flags

`FRONTIER_MODEL` (gguf, embedded) or `LLM_BASE` (any OpenAI-compatible endpoint) — the single-frontier
escalation · `--routing <config.json>` / `$SG_ROUTING` (N-tier) + `--policy` / `$SG_POLICY`
(`no-egress|allow-mid|allow-all`) · `LOCAL_MODEL` (gguf — semantic coverage: paraphrases hit the stock,
opt-in) · `--room <dir>` (default `./sgc`) · `--store <f.json>` (durable cross-restart stock,
default `.skynet-stock.json`) · `--port` (default 4747, binds 127.0.0.1).

---

AGPL-3.0-or-later · © 2026 Nathanael Braun · solo-author project ·
engine: [github.com/9pings/skynet-graph](https://github.com/9pings/skynet-graph) ·
docs site: [9pings.github.io/mindsmith](https://9pings.github.io/mindsmith/) (GitHub Pages) ·
**pre-launch — nothing is field-adopted yet (rung 6/6)**
