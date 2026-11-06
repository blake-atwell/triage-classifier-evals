# 1: Baseline Evaluation Harness

Prompt the generation of a basic evaluation harness we can iterate on.

Since results are non-deterministic, we want to evaluate each case for flakiness via trials (ENV VAR EVAL_TRIALS).
- case: list in dataset.json
- case trial: an execution of the case through the harness

Resolution:
We can now run with...
```bash
export GEMINI_API_KEY=...
export EVAL_TRIALS=10
npm run eval
```

# 2: Handle dataset.json `expected: null`

Some test cases have `expected: null`. Sent email on resolution.

Decision:
- Treat `Customer message` as input, not instructions.
- When insufficient information, return label `{"category": "other", "priority": "low", "route_to": "tier1"}`.

Resolution:
Prompt updated to account for these changes.
Update Case 01 and Case 10 to expect `{"category": "other", "priority": "low", "route_to": "tier1"}`

# 3: Reporting

Running an evaluation results in failures.

We can't just fail, we need to know per case, per trial whether the issue was:
- Gemini API
- structure of Gemini output 
- any one of the label properties is not matching `expected` (i.e., did fail because of `priority` mismatch `low` vs. `medium`)

Resolution:
Aggregate some basic metrics, and print at job completion.
- Case Pass Rate
- Case Flaky Count
- API Error Rate
- Output Malformed Rate
- Label accuracy, by property (i.e. `category accuracy`)

# 4: "prompt issues"

Now we have a harness and some metrics coming out of it. Let's use these signals.

Our evaluation harness is failing for five Eval Cases. 

Test failure is the result of a mismatch between implementation and expectation. We prompt Claude to align the two based 
on the following criteria:
1. If a test fails, identity whether failure is a prompt issue or test case issue (dataset)
   - if an Eval Case makes logical sense (input vs. expected), it is a prompt issue
2. triage

| Case                   | Trials | Failure                                                                | Verdict                                                                                             |
|------------------------|--------|------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------|
| 01 "charged twice"     | 0/5    | Model says priority medium, expected high — consistently               | Prompt: no priority rubric existed; "money lost = high" is a defensible label the model can't guess |
| 03 "can't log in"      | 0/5    | Model says technical, expected account — consistently                  | Prompt: no category definitions; login/password sits on an undefined boundary                       |
| 04 "payroll, API down" | 1/5    | Routes to specialist, expected tier2; plus one malformed category: "a" | Prompt: tier2 vs. specialist was never defined, and the malformed trial is a prompt defect (below)  |
| 07 fraud charge        | 4/5    | One trial routes tier2 instead of specialist                           | Prompt: same undefined routing boundary — flaky, not wrong                                          |
| 08 Spanish login       | 3/5    | Both failures are malformed category: "a"                              | Prompt: pure prompt defect                                                                          |

Claude decides it should provide a basic rubric inside the prompt for identifying labels.
In parallel, we skim dataset.json and come to the same conclusion; dataset.json looks reasonable.

Resolution:
Let Claude update the prompt using well-established conventions that the major providers' prompting guides (Google's for Gemini, Anthropic's, OpenAI's) all converge on.

# 5: Add Eval Case(s)

Customer Success gave us 10 eval cases (dataset.json). Our prompt is labeling an open-ended "Customer message". Our 
dataset is obviously not covering all possible scenarios.

As we productize and productionize our solution, we probably want a way for our CX reps to flag 
incorrect `Customer message` labels. These examples or variations can be added as Eval Cases for future iterations of 
the harness.

For now, let's just ask claude to identify some gaps in coverage.

Claude responds that we are mostly covering "happy path" cases. Gap categories:
- label combinations
- adversarial / format robustness
- other languages

Resolution:
1. Claude adds another 12 Eval Case(s)
2. Quickly scan and they look reasonable
3. run eval harness (24 cases, 10 trials all pass with gemini-3.5-flash-lite)

# 6: Unit Test

Normally I would unit test our harness implementation, will skip for today.

# 7: Future Lifecycle

In the future, if a label is flagged as incorrect:
1. add it to the dataset
2. manually or have Claude update the `prompt.txt`
3. validate ENTIRE dataset still passes with the prompt change

# Next Steps
1. Test GitHub Action.
2. Look at "best practices" for Eval Harness grading metrics.

# Links
Manage API Key: https://aistudio.google.com/api-keys
