# mindsmith

[![npm](https://img.shields.io/npm/v/mindsmith?logo=npm&color=cb3837)](https://www.npmjs.com/package/mindsmith)
[![npm downloads](https://img.shields.io/npm/dm/mindsmith?color=cb3837)](https://www.npmjs.com/package/mindsmith)
[![node](https://img.shields.io/node/v/mindsmith)](https://nodejs.org)
[![license](https://img.shields.io/npm/l/mindsmith?color=blue)](./LICENSE)

**Your small model fits your VRAM. Quantization stole its judgment on the way down.
mindsmith forges it back.** A certified method vocabulary steers it, an external critical
mind checks it, and covered questions are answered from *your* verified stock at **zero
frontier calls** — all on your box, nothing leaving by default. Point any OpenAI client at
it and go. The `-smith` is literal: you forge a mind for the model you can actually run.

> **Pre-launch. Nothing here is field-adopted yet — rung 6/6 is empty on every bar below.**
> We publish maturity per feature, and **a refuted claim comes off the page the day it falls**
> (several are still listed on purpose — knowing where the floor is *is* the product). The
> radical-honesty page: [honesty](https://9pings.github.io/mindsmith/honesty.html).

Built on the [skynet-graph](https://github.com/9pings/skynet-graph) reasoning engine — the
substrate + the combos this appliance puts to work.

## What it does

- **Forge — repair the low-quant.** A menu of *certified* method shapes steers the model's
  output; a covered query is served from your verified local stock at **0 frontier calls**
  and can't hallucinate by construction. Measured on the *same* model at two quant levels:
  SQL covered queries **8→63 %** (N=201; high-quant reference 46→92 %) · finance-table
  traffic **7→62 %** (N=120; 20→78 %).
- **Check — an external mind, not a self-pep-talk.** `critique` weighs a question over a
  witness-gated pool and returns an honest, certification-aware verdict (or an honest
  UNDECIDED). `propose` / `hint` are gated think-mode lanes that hand back a *tested* verdict
  or a typed refusal — never a confident guess. All as MCP tools.
- **Own it — sealed by default.** OpenAI-compatible endpoint, no accounts, no catalog, no
  phone-home, **no-egress by default (enforced fail-closed on real sockets, with a negative
  control that proves the guard has teeth)**. Your stock lives in a local **room** you own:
  freeze it, checksum it, hand it to a colleague, import theirs — a malformed bundle is
  refused at the gate, never written.

## 60-second quickstart

```bash
# Install (on npm):
npm i -g mindsmith            # per-project: npm i mindsmith  ·  one-shot: npx mindsmith
# Running a local .gguf (embedded or single-model) needs the local runtime once — prebuilt, no compile:
npm install node-llama-cpp
# On WSL, export this or the gguf silently falls back to CPU:
export LD_LIBRARY_PATH=/usr/lib/wsl/lib:/usr/lib/x86_64-linux-gnu

# 1 — serve. Escalation is ONE of: an embedded gguf, an OpenAI endpoint, or an N-tier routing config.
FRONTIER_MODEL=/path/model.gguf mindsmith serve --room ./sgc
# → mindsmith → http://127.0.0.1:4747/v1   (OpenAI-compatible, binds 127.0.0.1)
# (no local runtime? point at an endpoint instead: LLM_BASE=<url> mindsmith serve)

# 2 — point ANY OpenAI client at it (official SDKs, LangChain, Open WebUI, curl):
#     baseURL = http://127.0.0.1:4747/v1     apiKey = anything
curl -si http://127.0.0.1:4747/v1/chat/completions \
  -H 'content-type: application/json' \
  -d '{"messages":[{"role":"user","content":"your question"}]}'
# every completion carries provenance headers, so you always know what you got:
#   x-sg-served-from: local|frontier · x-sg-arm · x-sg-cost · x-sg-coverage · x-sg-saved · x-sg-sgc-version

# 3 — your stock rooms (local .sgc mini-repos, gate-checked on every load):
mindsmith rooms list                          # inventory: name@version, classes, sha256, ❄ frozen
mindsmith rooms import ./fin-tables-stock.sgc # a bad bundle never lands
mindsmith rooms freeze fin-tables-stock       # writes the auditable sha256 dossier
mindsmith rooms export fin-tables-stock ./out # bundle + dossier, ready to share

# 4 — or wire it into an agent host as MCP tools (Claude Code, any MCP client):
claude mcp add mindsmith -- mindsmith mcp --routing routing.json
# tools: ask · drift · metrics · lattice_load · critique  (+ hint · propose once a methods stock is loaded)
```

The demo and the test suite live in the [repo](https://github.com/9pings/mindsmith), not the
npm tarball — `git clone` for those; npm is for *running* the appliance and *embedding* the
engine. `GET /healthz` is the ops readout (no key, no query content): policy, configured vs
reachable tiers, loaded `.sgc` versions, stock size.

## One model. One load. The whole appliance.

Most VRAM-constrained boxes have room for exactly **one** model. Fine — that's all mindsmith
needs:

```bash
mindsmith serve --model /path/model.gguf     # ONE gguf, ONE VRAM load
```

That single load is doing **both** jobs at once. Your users get a full local LLM server whose
answers run **with** native reasoning (think). The graph's structured work — coverage,
`critique`, `propose` — runs on the **same** weights **without** think. How? The thinking
budget is **per-call, not per-load**: one set of weights in VRAM, two behaviours out of it. A
box that can hold a single model still gets the entire appliance — server *and* value-add — for
one model's worth of memory.

Tune the load: `--ctx <N>` · `--gpu auto|cuda|metal|vulkan|false` · `--gpu-layers <N>` ·
`--think <tokens>` (the answer-side reasoning budget, default 1024). Need a custom llama.cpp
build? `--no-prebuilt` builds from source, `--llama-build auto|forceRebuild|never` controls it,
and `LLAMA_CMAKE=<json>` passes cmake options through.

## Features × maturity

Maturity uses a fixed 6-rung scale: **1** coherent idea · **2** design with pre-registered
kill-gates · **3** mechanics proven · **4** measured at scale · **5** product-integrated ·
**6** field-adopted (external replications). **Nothing is at 6 — this is pre-launch.** Scale
detail: [honesty](https://9pings.github.io/mindsmith/honesty.html).

| Feature | Maturity | Measured |
|---|---|---|
| **F1 — Low-quant repair** — certified stock steers the model; covered → 0 frontier calls | `█████░` 5/6 product-integrated | SQL **8→63 %** (N=201) · finance tables **7→62 %** (N=120) · forge **0 false admissions** (3 datasets × 2 forge models) |
| **F4 — External think mode** — `propose` → gated verdict + blame + gate-tested options; `hint` menu | `█████░` 5/6 product-integrated | one dialogue round **17/24 → 24/24** at **zero false admissions**; a forced write lands UNTRUSTED, never admitted |
| **F5 — External critical mind** — `critique`: witness gate, anchored generation, honest verdict | `█████░` 5/6 surface (campaign numbers at 4/6) | coverage **77 % vs 58 %** (48 args) · certified perimeter **12/24 → 24/24** · **0 fabrication** in negative controls (8/8 injected theses retracted) |
| **F6 — Local `.sgc` rooms** — list/import/export/freeze, sha256 dossiers, engine-gated loads | `█████░` 5/6 product-integrated | gate-checked import; loads never bypass the engine gates |
| **F2 — Piece-by-piece zoom** — typed DAG on big tasks | `████░░` 4/6 measured — **library-only in the engine today; NOT surfaced here (the known gap)** | math word problems **×3.25** [2.4–4.8] · financial-table QA **×2.54** [1.96–3.5], 560 tasks |

## The illusion this kills

Ask a low-quant model to weigh two sides of a real question and it picks a winner with total
confidence — and is right about as often as a coin. In a head-to-head (24 composed perimeters,
gold hidden, every arm re-run bit-identical), the naive single call and the *same model with a
1024-token native think budget* both score **13/24 ≈ chance**, each throwing 11 confident wrong
verdicts and refusing zero times. And it doesn't know: measured self-believed coverage runs
**~106 %** against a real gold of **64–77 %** — it's sure it covered everything when it didn't.

The external critical mind renders **0 wrong verdicts across all 48 debates**. Two things buy
that. First, it decides mechanically **only at a measured margin** — and below it returns counts
+ coverage + an honest **UNDECIDED** instead of flipping a coin. Second, a **certified
perimeter closes the illusion**: declaring what you're judging against takes the decision from
**12/24 to 24/24**. mindsmith declines; it doesn't guess. That's the whole point.

## Why not just…?

- **…run a bigger model?** If it fits your VRAM, do. mindsmith is for the model you *can*
  run: certified-stock steering recovers most of what quantization broke (SQL 8→63 %, finance
  7→62 %), at 0 frontier calls on the covered slice.
- **…use the model's think mode, or a self-critique prompt?** The 2024–25 literature and our
  own 3-form refutation agree: self-critique underperforms *external* feedback with localized
  blame. A low-quant can't audit itself. The `propose` gate and `critique` tool are that
  external feedback — structural, auditable, and un-arguable-with (a forced write lands
  UNTRUSTED, never admitted). A prompt can always be talked out of it; a gate can't.
- **…RAG or a prompt library?** Retrieval trusts whatever got indexed. A room only admits
  what passes the gate (**0 false admissions** measured at the forge), and every completion
  tells you which slice you can trust (`x-sg-served-from`, `x-sg-coverage`).
- **…an agent framework's memory?** None we checked reopens a task whose premise drifted. The
  engine's typed task state retracts and reopens *with the reason*, at 0 model calls (surfaced
  on the engine side via MCP `state_recall` / `plan_sync`).

## What actually runs

- **`serve`** — `POST /v1/chat/completions`, `GET /v1/models`, `GET /healthz`. Default port
  4747, binds 127.0.0.1 on purpose. Covered query → served from verified local stock at 0
  frontier calls; a miss escalates (you always get an answer); the local side never fabricates.
- **Escalation — pick one.** A **single model** (`--model <path.gguf>`, the shared-load mode
  above) · a **single frontier** (`FRONTIER_MODEL=<path.gguf>` embedded, or `LLM_BASE=<url>`
  any OpenAI-compatible endpoint) · or **N-tier routing** (`--routing config.json`): ordered
  tiers, each tagged with an egress class (`none` / `mid` / `frontier`), under a policy ceiling
  — `no-egress` (default for routing configs) · `allow-mid` · `allow-all`. A query is **never**
  silently sent to a forbidden tier: if the policy leaves nothing reachable you get a typed
  `NO_REACHABLE_TIER` refusal. The no-egress guarantee is enforced fail-closed on real sockets
  in the test suite, with a negative control proving the guard bites.
- **`mcp`** — the same verified stock + escalation over stdio (no HTTP socket). Tools:
  `ask` (local-first, `{answer, source, cached, cost}`) · `drift` (invalidate a stale entry) ·
  `metrics` (economy readout) · `lattice_load` (learn *through* the gate — the only registry
  write path) · `hint` (SOFT lane: advisory certified-shape menu, no guarantee attached) ·
  `propose` (HARD lane: the gate never yields; `force=true` records untrusted provenance,
  never admits) · `critique` (below).
- **`rooms`** — `list | import <file> | export <name> <dest> | freeze <name>`. Import
  dry-loads the bundle through the same gates the appliance uses; freeze writes the sha256
  dossier that makes the bundle a fixed, auditable reference.

## The `critique` iteration contract

`critique` runs the external critical mind on a question: viewpoints established through a
**witness gate** over a statement pool, anchored generation of missing theses (drafted **only**
from pool witnesses — 0 fabrication across negative controls), a typed ledger, and a
certification-aware verdict. The contract: **OPEN ledger points and an UNDECIDED verdict are a
typed data request, not a dead end.** The tool can't reach the web — the host (you, or your
agent) gathers real statements that bear on the OPEN points and calls `critique` again with
`statements: [...]` (`"PRO: …"` / `"CON: …"` lines). The frame upgrades to MATERIAL and the
margin can move honestly. Below the measured decidability bound the deliverable is counts +
coverage + an honest UNDECIDED — never a fake weighing.

## Honest limits (what is NOT claimed)

This is the part every hype-y AI repo leaves out. We tested these, here's exactly what broke,
and it stays on the page.

- **The guarantee is at stock admission, not at execution.** Runtime steering *orients*; a
  suggestion is not a correctness proof. A runtime "trusted answers" cross-agreement tier was
  tested and **refuted** — removed, and still listed in
  [honesty](https://9pings.github.io/mindsmith/honesty.html).
- **The win lives on the typed, recurrent slice of your traffic.** Coverage depends on your
  stocks; forge yield is per-domain; amortization is a property of the domain's stereotypy.
  Free prose and genuinely novel reasoning stay in the model, without guarantee — by design.
- **F2 zoom is not surfaced here.** The piece-by-piece decomposition is measured (rung 4/6)
  but library-only in skynet-graph today; no MCP tool exposes it yet.
- **Verdicts are reliable only on certified perimeters or wide margins.** Below the measured
  decidability bound, `critique` returns UNDECIDED by design. Its entry templates
  (pool brainstorm, viewpoint naming) are not yet form-robustness-tested; on FREE frames
  coverage is relative to the pool (the payload says so).
- Streaming is simulated; no per-tier timeout yet.
- **Nothing is field-adopted (rung 6/6).** No external replications. This is pre-launch — and
  that's exactly the rung you can help fill.

## Env / flags

**Single-model:** `--model <path.gguf>` (or `MODEL`) · `--ctx` (`CONTEXT_SIZE`) ·
`--gpu auto|cuda|metal|vulkan|false` · `--gpu-layers` (`GPU_LAYERS`) · `--think <tokens>`
(`THINK_BUDGET`, default 1024) · custom build `--no-prebuilt` / `--llama-build` / `LLAMA_CMAKE`.
**Escalation (single frontier):** `FRONTIER_MODEL` (gguf, embedded) or `LLM_BASE` (any
OpenAI-compatible endpoint). **N-tier:** `--routing <config.json>` / `$SG_ROUTING` +
`--policy` / `$SG_POLICY` (`no-egress|allow-mid|allow-all`). **Coverage:** `LOCAL_MODEL`
(separate gguf — paraphrases hit the stock; opt-in). **Rooms/store:** `--room <dir>`
(default `sgc`) · `--store <f.json>` (durable cross-restart stock, default
`.skynet-stock.json`) · `--port` (default 4747, binds 127.0.0.1).

---

AGPL-3.0-or-later · © 2026 Nathanael Braun · solo-author project ·
engine: [github.com/9pings/skynet-graph](https://github.com/9pings/skynet-graph) ·
docs: [9pings.github.io/mindsmith](https://9pings.github.io/mindsmith/) ·
**pre-launch — nothing is field-adopted yet (rung 6/6)**
