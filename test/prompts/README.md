# Prompt collection — live-testable prompts for the mindsmith tool surface

One `.md` file = one scenario a HOST AI would run against `mindsmith mcp`. Each file carries the
natural-language prompt (what you'd paste into the AI) **and** the machine-checkable bars, so the
same file drives three uses:

1. **Manual** — paste the prompt into any AI wired to `mindsmith mcp` (`claude mcp add mindsmith …`)
   and read the trace yourself.
2. **Scripted (CI, 0-GPU)** — `npm test` runs `test/prompts-stub.test.js`: for every file with a
   `stub` section, the declared tool-call sequence is executed against the **real in-process MCP
   server** (`createMcpServer(...).handle(jsonrpc)` — the same dispatcher `mindsmith mcp` serves,
   no pipe, no sosie) with a scripted model behind it; the bars are asserted on the real results.
3. **Live (GPU/owner-gated)** — `node test/prompts/_live.js <file> ` with `LLM_BASE=<openai-compatible
   endpoint>` (e.g. a local llama-server): a minimal react-style driver gives the model the tool
   list + the prompt, executes its tool calls against the same in-process server, and asserts the
   SAME bars on the live trace. **Ask before any GPU run.**

## Can this auto-test what a human would test? (the honest scope)

**Yes, with three disciplines** — without them a prompt collection rots into flakiness:

- **Bars are STRUCTURAL, never prose.** A bar asserts *the tool was called*, *the refusal is typed*,
  *the verdict field exists*, *nothing was silently lost* — mechanical regexes on JSON results.
  It never asserts the model's wording, and it never uses an LLM to judge an LLM (the self-audit
  path is refuted and stays out).
- **Live is a SMOKE, not a benchmark.** One live pass proves the surface end-to-end on one model;
  it measures nothing. Measured claims stay in the recorded campaigns.
- **CI never needs a GPU.** The `stub` section IS the deterministic coverage; live runs are
  owner-triggered, and a live transcript can be checked in later to replay-pin a scenario.

## File format

The file starts with a JSON front-matter block, then the prose prompt:

    ---json
    {
      "tools":  { "wired": ["self_consistency"] },
      "modes":  ["stub", "live"],
      "stub": {
        "replies": [ { "match": "attempt 1", "reply": "ANSWER: 42" } ],
        "calls":   [ { "tool": "self_consistency", "args": { "question": "…" } } ]
      },
      "bars": [
        { "call": "self_consistency", "match": "\"verdict\":\"42\"" },
        { "final": "42" }
      ]
    }
    ---
    The natural-language prompt for the host AI goes here.

- `stub.replies` — the scripted model: ordered `{match, reply}` pairs; each incoming model prompt
  consumes the FIRST unconsumed pair whose regex matches; an unmatched prompt **throws** (fail
  loud, never a silent default).
- `stub.calls` — the tool-call sequence the host AI would make (what the live driver's model
  decides by itself).
- `bars` — `{call, match}` = regex over the JSON result of that tool's LAST call; `{call, absent}`
  = regex that must NOT match; `{never}` = the tool must not have been called; `{final}` = regex
  over the live model's final message (live mode only; ignored in stub).
- `modes` — `"stub"`-less files are SKIPPED by CI with a printed reason (no silent caps).
