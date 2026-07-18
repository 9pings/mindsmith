---json
{
  "tools": { "wired": ["self_consistency"] },
  "modes": ["stub", "live"],
  "stub": {
    "replies": [
      { "match": "attempt 1 of", "reply": "Two dozen is 24, minus the 3 broken ones.\nANSWER: 21" },
      { "match": "attempt 2 of", "reply": "24 - 3 = 21\nANSWER: 21" },
      { "match": "attempt 3 of", "reply": "ANSWER: 21.0" },
      { "match": "attempt 4 of", "reply": "I think 24 eggs total.\nANSWER: 24" },
      { "match": "attempt 5 of", "reply": "no final line in this path" }
    ],
    "calls": [
      { "tool": "self_consistency", "args": { "question": "A farmer has two dozen eggs; 3 break. How many are left?" } }
    ]
  },
  "bars": [
    { "call": "self_consistency", "match": "\"verdict\":\"21\"", "why": "the majority class wins (21.0 snaps to 21)" },
    { "call": "self_consistency", "match": "\"abstained\":1", "why": "a path with no parsable ANSWER line is NOT a vote class — counted, never silently lost" },
    { "call": "self_consistency", "match": "\"agree\":3" },
    { "final": "21" }
  ]
}
---
Use the self_consistency tool to answer this reliably, then give me the number it settled on:
A farmer has two dozen eggs; 3 break. How many are left?
