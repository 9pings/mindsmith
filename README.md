# skynet-dequantizer

**Your low-quant local model, repaired and steered like a bigger one — and nothing leaves the machine.**

An OpenAI-compatible local proxy over the [skynet-graph](https://github.com/9pings/skynet-graph) engine. You run a heavily-quantized
gguf because it fits your VRAM; quantization broke part of its judgment. This appliance steers the model's
output against a **certified method vocabulary** (`.sgc` stocks) and serves covered queries from **verified
local stock at zero model calls** on repeats. Measured effect of the steering on the same model at two quant
levels (campaign protocols in the engine repo): SQL covered queries low-quant **8→63 %** (high-quant 46→92 %,
N=201) · finance traffic **7→62 %** (20→78 %, N=120) — *at zero big-model runtime calls*.

**No accounts, no catalog, no phone-home.** Stocks live in a local **room** you own: build them with the
engine's forge, freeze them (auditable sha256 dossier), share them as files, import someone else's —
a malformed bundle is refused at the gate, never written.

## Quick start

```bash
npm install && npm test      # GPU-free (stub frontier + local room)

# serve (embedded gguf):
FRONTIER_MODEL=/path/model.gguf npx skynet-dequantizer serve --room ./sgc
# → point ANY OpenAI client at http://127.0.0.1:4747/v1   (apiKey: anything)

# or as MCP tools for an agent host (Claude Code, etc.):
claude mcp add skynet -- skynet-dequantizer mcp --routing routing.json
```

## Your stock rooms — the community model

```bash
skynet-dequantizer rooms list                          # inventory: name@version, classes, sha256, ❄ frozen
skynet-dequantizer rooms import ./finqa-stock.sgc      # gate-checked (a bad bundle never lands)
skynet-dequantizer rooms freeze finqa-stock.sgc        # writes the auditable sha256 dossier
skynet-dequantizer rooms export finqa-stock ./shipped  # bundle + dossier, ready to share
```

Forge new stocks from any dataset with an executable oracle: `sg forge` (skynet-graph) — every admitted
method passed a **zero-false-admission** gate, and the dossier proves it.

## The guarantees (tested end-to-end, in this repo's suite)

- a covered query is served from **verified local stock at 0 frontier calls**; a miss escalates (you always
  get an answer); the local side never fabricates → **0 hallucination by construction** on the covered slice;
- bundles load **through the engine's admission gates** (version-gated; never a raw write) — including on
  import into your room;
- **no-egress, proven on real sockets**: an armed fail-closed guard on `net.connect` shows the appliance
  connects to *nothing* but the declared frontier — with a negative control proving the guard has teeth.
  Default policy is `no-egress`; multi-tier routing (`--routing`, `--policy`) is opt-in and policy-governed.

## Honest bounds

The steering *orients* — a suggestion is not a correctness proof (guarantees are at stock **admission**, not
at execution). The win lives on the typed, recurrent slice of your traffic; coverage depends on your stocks.
Streaming is simulated; no per-tier timeout yet.

## Env / flags

`FRONTIER_MODEL` (gguf) or `LLM_BASE` (any OpenAI-compat endpoint) — required for escalation ·
`LOCAL_MODEL` (semantic coverage: paraphrases hit the stock, opt-in) · `--room <dir>` (default `./sgc`) ·
`--store <f.json>` (durable cross-restart stock) · `--port` (default 4747, binds 127.0.0.1 on purpose).

AGPL-3.0-or-later · © 2026 Nathanael Braun
