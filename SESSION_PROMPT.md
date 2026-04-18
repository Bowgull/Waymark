# Session prompt template

Paste this at the start of every build session. Change only the `Step:` line.

---

```
Read BUILD_PLAN.md first. Re-read the Hard Rules and Voice Canon before writing any code or copy.

Step: 1

Execute that step only. Do not pre-build later steps. Do not refactor adjacent code unless the step requires it.

When finished:
1. Update the step status in BUILD_PLAN.md (TODO to DONE, or to DOING/BLOCKED with a reason).
2. Append one entry to the Session Log (date, step, what was done, what's next).
3. Commit with a message that matches the voice canon (short, no hype, no em dashes).

If anything in the step is ambiguous, ask one question before proceeding. Do not guess.
```

---

## Rules for resuming mid-step

If a prior session left a step in `DOING`, continue from where the Session Log left off. Do not restart the step unless the log says it was abandoned.

## Rules for scope creep

If during a step you find something that needs fixing but is out of scope, do not fix it. Add it to the step's Notes field in BUILD_PLAN.md. The user decides whether to promote it to its own step.
