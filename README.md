# skynet-client — the local appliance (PRIVATE)

The **client half** of the product: an OpenAI-compatible endpoint over a **small local model** + a
**verified SGC stock**, kept fresh from a [skynet-server](../skynet-server) catalog. Runs on a laptop /
small PC (a ~5 GB gguf, CPU or small GPU). Thin assembly over the engine
([skynet-graph](../skynet-graph), `file:` dependency — the private product branch).

**The guarantees (carried from the engine, tested here end-to-end):**
- a covered query is served from the **verified local stock at 0 frontier calls**; a miss escalates
  (the user always gets an answer); the local side never fabricates → **0 hallucination**;
- catalog pulls are **sha256-verified** (a tampered bundle is rejected, never written) and bundles load
  **through the engine's admission gates** (version-gated, confluence-checked — never a raw write);
- **personal data never leaves the process**: the only outbound calls are the declared frontier and the
  declared catalog (and the catalog only ever sees the token, never query content).

```bash
npm install && npm test                        # 3 tests, GPU-free (stub catalog + stub frontier)

# run (embedded model):
FRONTIER_MODEL=/path/big.gguf node bin/skynet-client serve --catalog https://…  --port 4747
# → point ANY OpenAI client at http://127.0.0.1:4747/v1   (apiKey: anything)

# one-shot catalog sync:
node bin/skynet-client pull --catalog https://… --key <token>
```

Env: `FRONTIER_MODEL` (gguf) or `LLM_BASE` (endpoint) — required; `LOCAL_MODEL` (semantic coverage,
opt-in); `CATALOG_URL` / `CATALOG_TOKEN`. Packaging (Docker / single-file bundle) = roadmap M6.
