# MindSmith

<p align="center">
<img src="./docs/img/headImg.png">
</p>

<p align="center">

[![npm](https://img.shields.io/npm/v/mindsmith?logo=npm&color=cb3837)](https://www.npmjs.com/package/mindsmith)
[![npm downloads](https://img.shields.io/npm/dm/mindsmith?color=cb3837)](https://www.npmjs.com/package/mindsmith)
[![node](https://img.shields.io/node/v/mindsmith)](https://nodejs.org)
[![license](https://img.shields.io/npm/l/mindsmith?color=blue)](./LICENSE)

</p>

**MindSmith gives your local LLM an external reasoning layer — and a memory it can own.**
Your agents get **named, persistent graph workspaces** they grow over days (a debate that
accumulates evidence, a roadmap that reopens when a premise drifts, a shared notepad — every
write attributed to the agent that made it), a **guarded toolset** (an external critical mind,
gated think-mode lanes, piece-by-piece serving of big tasks), and a **local-first
OpenAI-compatible endpoint** that answers covered questions from *your* verified stock at zero
frontier calls. All on your box, nothing leaving by default. Works for any model, any size;
low-quant models benefit the most, but the guarantees hold regardless.

> **Pre-launch. Nothing here is field-adopted yet — rung 6/6 is empty on every bar below.**
> We publish maturity per feature, and **a refuted claim comes off the page the day it falls**
> (several retired claims are listed on purpose — knowing where the floor is *is* the
> product). The radical-honesty page: [honesty](https://9pings.github.io/mindsmith/honesty.html).

Built on the [skynet-graph](https://github.com/9pings/skynet-graph) reasoning engine.
MindSmith is the appliance that puts the engine in your hands: the **instance service**, the
**MCP tool surface**, the **endpoint**, the **rooms**.

## What it does

- **Remember — named graph instances.** `instances_create` a typed workspace and your agents
  enrich it across sessions through typed, attributed actions: a **dialectic** debate whose
  day-2 evidence is re-examined against the whole grown pool, a **plan** whose steps carry
  `needs` wiring and reopen with a reason, a **notepad** for shared state. Persisted as one
  auditable `.sgp` pack per instance (a plain zip — open it with any tool), findable by
  text/tags, forkable, shareable over HTTP — and every fact knows who wrote it.
- **Check — an external mind, not a self-pep-talk.** `critique` builds the case *for you to
  judge*: viewpoints established through a witness gate over a statement pool, missing theses
  drafted only from real witnesses (0 fabrication across negative controls), attacks and
  standing on the record, and a self-contained `judgePrompt` **your model** runs to render the
  decision. The graph guarantees the arguments; the weighing is the model's job — counts and
  margins are a stop signal, never a dressed-up verdict. Below the bound it says UNDECIDED
  instead of guessing.
- **Steer — certified stock, zero frontier calls when covered.** A menu of *certified* method
  shapes steers the model; a covered query is served from your verified local stock and can't
  hallucinate by construction. Measured on the same model at two quant levels: SQL covered
  queries **8→63 %** (N=201) · finance-table traffic **7→62 %** (N=120).
- **Own it — sealed by default.** OpenAI-compatible endpoint, no accounts, no catalog, no
  phone-home, **no-egress by default** (enforced fail-closed on real sockets, with a negative
  control proving the guard bites). Your stock lives in local **rooms** you own; your
  workspaces live in a local instances directory you own. A malformed bundle or a corrupted
  pack is refused at the gate, never written.

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
# every completion carries provenance headers, so you always know what you got:
#   x-sg-served-from: local|frontier · x-sg-cost · x-sg-coverage · x-sg-sgc-version

# 3 — wire it into an agent host as MCP tools (Claude Code, any MCP client):
claude mcp add mindsmith -- mindsmith mcp
# the INSTANCE SERVICE is on by default: your agent can now
#   instances_create {type:"dialectic", seed:{topic:"..."}, agent:"claude-1"}   → mindsmith://dialectic/dialectic-1
#   dialectic_addArguments · dialectic_addViewpoint · dialectic_state · dialectic_brief
#   plan_addSteps · plan_complete · plan_reopen · plan_sync    (the persistent roadmap)
#   notepad_note · notepad_recall                              (shared state-memory)
#   instances_search · instances_fork · instances_revisions (who wrote what) · instances_sync
# plus the reasoning toolset: ask · critique · self_consistency · zoom · drift · metrics ·
#   lattice_load · methods_describe · lattice_rings · trace_tail
#   (+ hint · propose once a methods stock is loaded in the room)

# 4 — your stock rooms (local .sgc mini-repos, gate-checked on every load):
mindsmith rooms list                          # inventory: name@version, classes, sha256, ❄ frozen
mindsmith rooms import ./fin-tables-stock.sgc # a bad bundle never lands

# 5 — share a workspace out of band (the pack IS the wire format):
mindsmith serve --instances ~/.mindsmith/instances
curl -O http://127.0.0.1:4747/instances/dialectic/dialectic-1   # the .sgp, byte-identical
curl -X POST --data-binary @dialectic-1.sgp -H 'x-sg-agent: you' \
     http://other-box:4747/instances/import                      # imports mint a NEW id
```

The demo and the test suite live in the [repo](https://github.com/9pings/mindsmith), not the
npm tarball — `git clone` for those; npm is for *running* the appliance. `GET /healthz` is the
ops readout (no key, no query content).

## Named instances — the working memory your agents share

The instance service is the reason MindSmith exists as its own package. A **type descriptor**
(shipped by an engine plugin) declares a workspace's typed actions once, and MindSmith
generates the MCP tools, dispatches them, persists the result and serves the sharing — so
every type gets the same guarantees:

| Type | What it is | Typed actions (each also a generated MCP tool) |
|---|---|---|
| `dialectic` | the LIVING debate — C9 as a workspace agents feed over days | `addArguments` (evidence grows the pool) · `addViewpoint` (a new point explored against the *grown* pool) · `verdict` · `state` · `brief` (the judgment dossier + `judgePrompt`) |
| `plan` | the persistent roadmap | `addSteps` (needs-wiring checked at the door — a step needing what nobody produces refuses the whole batch, *named*) · `complete` / `reopen` (guarded, with reason) · `snapshot` (frontier = actionable now) · `sync` (a typed delta you apply verbatim to your host's task list — `reopen` included, the op no host does natively) |
| `notepad` | shared state-memory | `note` · `recall` (every note carries its writer) |

What holds for every type, by construction:

- **Attribution is first-class.** Every write carries `agent`; the runner stamps it on every
  fact — a write without an agent is a typed refusal. `instances_revisions` reads the authors
  back per revision. "Who added which argument, in which fork" is auditable.
- **One `.sgp` pack per instance** — a plain zip (`manifest.json` + one JSON per member
  graph): the file on disk, the HTTP download and the import payload are the *same* artifact,
  byte-identical, openable with any zip tool. The catalogue is *derived* from the packs
  (no index database to drift). Corrupt pack → typed refusal, nothing written.
- **Residency is managed.** A hot instance lives in **its own worker thread** (your MCP/LLM
  process is never saturated by a stabilization), persists at settle points, is evicted after
  an idle TTL and transparently rehydrated on the next touch. A crashed worker is just cold —
  the next open resumes from the last persisted pack.
- **Refusals are data, not errors.** Unknown action, missing agent, a gate that says no, a
  needs-hole in a plan batch — each comes back typed and *named*, for the agent to act on.
- **Fork / merge.** `instances_fork` isolates an agent's work; merges preserve the original
  authors; a merged child is tombstoned, never silently erased.

**Rooms vs instances:** a **room** (`.sgc`) is your *read-only, verified* reference stock —
frozen, checksummed, gate-checked on load. An **instance** (`.sgp`) is a *mutable, living*
workspace. The appliance runs both: verified fuel, working memory.

## One model. One load. The whole appliance.

```bash
mindsmith serve --model /path/model.gguf
```

That single load handles **both** jobs: your users get a full local LLM server whose answers
run **with** native reasoning (think), while the graph's structured work — coverage,
`critique`, `propose` — runs on the **same** weights **without** think. The thinking budget is
per-call, not per-load: one set of weights in VRAM, two behaviours out of it. Tune the load:
`--ctx <N>` · `--gpu auto|cuda|metal|vulkan|false` · `--gpu-layers <N>` · `--think <tokens>`.

## Persistent config

Configure a machine once — `~/.mindsmith/config.json` (or `--config <file>` /
`$MINDSMITH_CONFIG`): model **aliases** under normalized names (`local`, `frontier`,
`judge`…, gguf paths or OpenAI-compatible servers, alias links followed), plus defaults,
timeouts, and the rooms/instances directories. Precedence everywhere: flags > env > config
file > built-in defaults. A written config is never silently ignored (typed error on parse
failure).

```json
{ "models":   { "local": { "model": "~/models/q2.gguf" }, "frontier": { "base": "http://…/v1" } },
  "defaults": { "model": "local", "escalation": "frontier" },
  "instances": { "dir": "~/.mindsmith/instances", "placement": "worker" },
  "rooms":    { "dir": "~/.mindsmith/rooms" } }
```

## Features × maturity

Maturity uses a fixed 6-rung scale: **1** coherent idea · **2** design with pre-registered
kill-gates · **3** mechanics proven · **4** measured at scale · **5** product-integrated ·
**6** field-adopted (external replications). **Nothing is at 6 — this is pre-launch.** Scale
detail: [honesty](https://9pings.github.io/mindsmith/honesty.html).

| Feature | Maturity | Evidence |
|---|---|---|
| **Instance service** — named persistent workspaces (dialectic · plan · notepad), attributed writes, `.sgp` packs, worker residency, HTTP sharing | `███░░░` 3/6 mechanics proven, product-wired | structural suites end-to-end (typed refusals, byte-identical packs across runs and placements, worker-saturation pair, crash-recovery); **no at-scale campaign yet** |
| **Certified stock steering** — covered → 0 frontier calls | `█████░` 5/6 product-integrated | SQL **8→63 %** (N=201) · finance tables **7→62 %** (N=120) · forge **0 false admissions** (3 datasets × 2 forge models) |
| **External critical mind** — `critique`: witness gate, judgment brief, honest UNDECIDED | `█████░` 5/6 surface | **0 fabrication** in negative controls (8/8 injected theses retracted) · without a declared frame it *refuses honestly* rather than render false verdicts — the arguments are guaranteed, the weighing is your model's (see below) |
| **External think mode** — `propose` gated verdict + blame + tested options; `hint` menu | `█████░` 5/6 product-integrated | one dialogue round **17/24 → 24/24** at **zero false admissions** (closed domain); a forced write lands UNTRUSTED, never admitted |
| **Piece-by-piece zoom** — big tasks served as a typed DAG, bounded contexts | `████░░` 4/6 measured · surfaced as the `zoom` tool | math word problems **×3.25** [2.4–4.8] · financial-table QA **×2.54** [1.96–3.5], 560 tasks; a plan whose needs nobody produces is refused *before* any model call |
| **Local `.sgc` rooms** — list/import/export/freeze, sha256 dossiers, engine-gated loads | `█████░` 5/6 product-integrated | gate-checked import; loads never bypass the engine gates |

## How `critique` decides — and what it refuses to fake

Ask a model to weigh two sides of a real question and it will usually pick a winner with full
confidence. What the external critical mind changes is not "a smarter verdict" — it is **what
gets to count as an argument**. Every point on the table must name the pool statements that
actually carry it; a point that cites nothing does not get in, *including the ones the model
invents itself*, which face the same gate (0 fabrication across negative controls). Attacks
and standing land on the record. What you get back is a **judgment brief** — theses, verbatim
witnesses, open points, structural facts — plus a self-contained `judgePrompt` your model runs
to render a justified decision with a stated certainty.

The division of labour is deliberate: **the graph guarantees the arguments; the model weighs
them.** A count of points per side is a *stop signal* (below the bound the mechanical layer
says UNDECIDED and hands you the counts), never a judgment dressed as a proof. An earlier
head-to-head that scored the mechanical count against naive prompting was **retired** when we
found the arms unequal — the retirement is documented on the
[honesty page](https://9pings.github.io/mindsmith/honesty.html), and what survived every
control is exactly what ships: real arguments, honest refusals, and the judge is you.

**The iteration contract:** OPEN ledger points and an UNDECIDED verdict are a typed data
request, not a dead end. The tool can't reach the web — the host gathers real statements that
bear on the OPEN points and calls `critique` again with `statements: [...]`; the frame
upgrades to MATERIAL and the margin can move honestly. Or keep the debate as a **dialectic
instance** and let it grow across days — day-2 evidence is explored against the whole grown
pool, and the refusals stay journaled.

## Why not just…?

- **…run a bigger model?** If it fits your VRAM, do. MindSmith works with the model you have:
  certified-stock steering recovers accuracy on covered queries, at 0 frontier calls on the
  covered slice — and the instance service is model-independent working memory.
- **…use the model's think mode, or a self-critique prompt?** Self-critique underperforms
  *external* feedback with localized blame (the 2024–25 literature and our own 3-form
  refutation agree — nothing in MindSmith self-scores, by rule). A prompt can be talked out of
  its objection; a gate can't: a forced write lands UNTRUSTED, never admitted.
- **…RAG or a prompt library?** Retrieval trusts whatever got indexed. A room only admits what
  passes the gate (0 false admissions measured at the forge), and every completion tells you
  which slice you can trust.
- **…an agent framework's memory?** Session summaries don't reopen. A `plan` instance's step
  reopens *with the reason* when you retract its premise, and `plan_sync` hands your host the
  typed `reopen` op. And none we checked can answer "which agent wrote this fact, in which
  fork" — here that's `instances_revisions`, built in.

## What actually runs

- **`serve`** — `POST /v1/chat/completions`, `GET /v1/models`, `GET /healthz`. Default port
  4747, binds 127.0.0.1 on purpose. Covered → verified local stock at 0 frontier calls; a miss
  escalates (you always get an answer); the local side never fabricates. With
  `--instances [dir]`: `GET /instances/<type>/<id>` (the `.sgp`, synced-then-served) +
  `POST /instances/import` (mints a new id; corrupted pack = typed 400, nothing written).
- **Escalation — pick one.** A **single model** (`--model`, the shared-load mode) · a **single
  frontier** (`FRONTIER_MODEL` gguf or `LLM_BASE` endpoint, or a config alias) · or **N-tier
  routing** (`--routing config.json`): ordered tiers tagged with egress classes under a policy
  ceiling — `no-egress` (default) · `allow-mid` · `allow-all`. A query is never silently sent
  to a forbidden tier; if nothing is reachable you get a typed `NO_REACHABLE_TIER` refusal.
- **`mcp`** — the full tool surface over stdio (no HTTP socket). The reasoning toolset —
  `ask` · `drift` · `metrics` · `lattice_load` · `critique` · `self_consistency` · `zoom` ·
  `methods_describe` · `lattice_rings` · `trace_tail` (+ `hint`/`propose` over the whole
  room's certified stock) — plus the **instance service on by default**: the generated
  `<type>_<action>` tools and the `instances_*` socle. One hot instance = one worker thread.
  The instances directory is owned by **one process** — `mcp` owns it by default; point
  `serve --instances` at it to share when the writing session isn't racing it.
- **`rooms`** — `list | import <file> | export <name> <dest> | freeze <name>`. Import
  dry-loads through the same gates the appliance uses; freeze writes the sha256 dossier.

## Honest limits (what is NOT claimed)

This is the part every hype-y AI repo leaves out. We tested these, here's exactly what broke,
and it stays on the page.

- **The stock guarantee is at admission, not at execution.** Runtime steering *orients*; a
  suggestion is not a correctness proof. A runtime "trusted answers" cross-agreement tier was
  tested and **refuted** — removed, and still listed in
  [honesty](https://9pings.github.io/mindsmith/honesty.html).
- **`critique` renders arguments, not truth.** The C9 head-to-head accuracy claim was
  **retired** (unequal arms — the honesty page documents it). What is measured and stands:
  0 fabrication, honest refusals without a declared frame, and the judgment brief contract.
  The weighing is your model's job, with your model's limits.
- **The instance service has no at-scale campaign yet** (rung 3/6): the mechanics are proven
  structurally (typed refusals, deterministic packs, worker isolation, crash recovery), not
  yet measured under real multi-agent load. A hard kill loses writes since the last persist
  point (create · sync · eviction · close) — by design, crash = cold, never a corrupt pack.
- **The win lives on the typed, recurrent slice of your traffic.** Coverage depends on your
  stocks; forge yield is per-domain. Free prose and genuinely novel reasoning stay in the
  model, without guarantee — by design.
- Streaming is simulated; no per-tier timeout yet.
- **Nothing is field-adopted (rung 6/6).** No external replications. This is pre-launch — and
  that's exactly the rung you can help fill.

## Env / flags

**Single-model:** `--model <path.gguf>` (or `MODEL`) · `--ctx` (`CONTEXT_SIZE`) ·
`--gpu auto|cuda|metal|vulkan|false` · `--gpu-layers` (`GPU_LAYERS`) · `--think <tokens>`
(`THINK_BUDGET`, default 1024) · custom build `--no-prebuilt` / `--llama-build` / `LLAMA_CMAKE`.
**Escalation:** `FRONTIER_MODEL` (gguf, embedded) · `LLM_BASE` (any OpenAI-compatible
endpoint) · or a `defaults.escalation` config alias. **N-tier:** `--routing <config.json>` /
`$SG_ROUTING` + `--policy` / `$SG_POLICY`. **Coverage:** `LOCAL_MODEL` (separate gguf —
paraphrases hit the stock; opt-in). **Rooms/store:** `--room <dir>` (default `sgc`) ·
`--store <f.json>` · `--port` (default 4747). **Instances:** `--instances <dir>` (default
`~/.mindsmith/instances`) · `--placement worker|in-proc` (default worker) · `--no-instances` ·
serve shares opt-in with `--instances [dir]`. **Config:** `--config <file>` /
`$MINDSMITH_CONFIG` (default `~/.mindsmith/config.json`).

## Docs & papers

Product pages: [features](https://9pings.github.io/mindsmith/features.html) ·
[honesty](https://9pings.github.io/mindsmith/honesty.html) (the maturity scale + every retired
claim). Engine docs (skynet-graph): [usage](https://github.com/9pings/skynet-graph/blob/master/docs/usage.md) ·
[architecture](https://github.com/9pings/skynet-graph/blob/master/docs/architecture.md) ·
[API](https://github.com/9pings/skynet-graph/blob/master/docs/API.md) ·
[plugins](https://github.com/9pings/skynet-graph/blob/master/docs/plugins.md) ·
[reasoning strategies](https://github.com/9pings/skynet-graph/blob/master/docs/strategies.md) ·
[capabilities & maturity](https://github.com/9pings/skynet-graph/blob/master/docs/CAPABILITIES.md).
The engine ships two companion preprints (open access, Zenodo, with bit-replayable in-repo
artifacts): **Defeasible Library Learning** —
[10.5281/zenodo.21201723](https://doi.org/10.5281/zenodo.21201723) — and **Sound online growth
of a typed *isa* lattice** — [10.5281/zenodo.21201877](https://doi.org/10.5281/zenodo.21201877).

---

AGPL-3.0-or-later · © 2026 Nathanael Braun · solo-author project ·
engine: [github.com/9pings/skynet-graph](https://github.com/9pings/skynet-graph) ·
docs: [9pings.github.io/mindsmith](https://9pings.github.io/mindsmith/) ·
**pre-launch — nothing is field-adopted yet (rung 6/6)**
