---
name: pipeline
description: Runs the full cycle of building, verifying, refactoring and finalizing a feature.
---

For the feature described by the user:

1. Present a short plan and wait for approval.
2. Implement it with tests. Run the tests until they pass. Commit.
3. Invoke the `reviewer` subagent.
4. Fix all CRITICAL and IMPORTANT items. Run the tests. Commit.
5. Refactor: remove duplication, improve names and structure, without
   changing behavior. Run the tests. Commit.
6. Invoke the `reviewer` again. If anything CRITICAL comes up, go back to
   step 4 (at most 3 cycles; after that, stop and report to me).
7. Deliver a summary: what was done, what was fixed, open items.
