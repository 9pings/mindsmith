---json
{
  "tools": { "wired": ["critique"] },
  "modes": ["live"],
  "why-no-stub": "the critique pipeline is a multi-stage C9 conversation (brainstorm/label/witness/synthesize); its scripted coverage lives in skynet-graph's own suite (critique.test.js, critique-grammar-parity.test.js) — re-scripting it here would duplicate a measured harness. This file is the LIVE smoke of the mindsmith wiring.",
  "bars": [
    { "call": "critique", "match": "\"frame\"", "why": "the frame (FREE/MATERIAL/DECLARED) is always announced" },
    { "call": "critique", "match": "\"verdicts\"|\"verdict\"|UNDECIDED", "why": "a typed outcome — a margin verdict or an honest UNDECIDED — never silence" },
    { "call": "critique", "match": "\"judgePrompt\"", "why": "the judgment layer hands the host its self-contained judge prompt" },
    { "final": "." }
  ]
}
---
Use the critique tool to debate the following, then tell me where the debate landed and what
evidence would change it:
Should a small open-source project accept anonymous code contributions?
