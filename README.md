# Customer Success Triage Classifier Evals

This is a live-coding exercise for AI Platform Engineer candidates.

The candidate may use any process of their choosing: any language, any agent, any LLM -- or none at all if you prefer. TypeScript is a sensible default. Bring your own Claude / Cursor / etc., or we can provision a Gemini API key at the start of the session.

## The task

You are a Platform Engineer who accelerates other team's AI implementations. The Customer Success engineering team wants to optimize the support process by triaging incoming support requests with an agentic workflow.

The CS team's system takes the customer message as input, applies it to a prompt, and returns a JSON object with `category`, `priority`, and `route_to`. The CS team has asked you to assist them in productionizing and operationalizing
their prompt. As part of the Platform standards, you identify that they need an **evaluation harness** to measure and verify the prompt implementation, and that this harness needs to run as part of the teams unit test suite in CI/CD.

**Your job is to build an evaluation harness for this prompt that the CS team will run in CI/CD.**

The CS team's prompt lives in [`prompt.txt`](./prompt.txt), and a small set of labeled examples we believe are correct lives in [`dataset.json`](./dataset.json).

Think out loud. There is no "finished" state we are looking for — we want to see how you reason about evaluating an LLM-powered system. Treat the panel as your team; ask us anything.

## The system under test

The prompt currently deployed in production is in [`prompt.txt`](./prompt.txt). The literal string `{message}` is replaced with the raw customer input at runtime.

## The dataset

Ten cases live in [`dataset.json`](./dataset.json). Each case has an `id`, an `input` (the customer message), and — where we have one — an `expected` label with `category`, `priority`, and `route_to`.

## Guidelines

- Use any language, runtime, and LLM you are comfortable with.
- You may modify, extend, or replace the dataset.
- You may modify the prompt if you have a reason to — tell us why.
- Treat the panel as your team. Ask clarifying questions, push back, request things.

## Setup

If you brought your own tooling (Claude Code, Cursor, a local repo, etc.), use it. Otherwise tell us and we will provision an API token and a scratch environment.

A minimal TypeScript scaffold is provided in [`src/index.ts`](./src/index.ts) — `getClient`, `callModel`, and `loadPrompt`. It expects `GEMINI_API_KEY` in the environment and will throw if it is missing. Use it, ignore it, rewrite it, or work in another language entirely.

```
npm install
export GEMINI_API_KEY=...
```

### Possible run commands

Using `tsx`:

```
GEMINI_API_KEY=... npx tsx src/index.ts
```

Using `tsc`:

```
npx tsc && GEMINI_API_KEY=... node dist/index.js
```