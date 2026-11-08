---
name: classification
description: Classify text or evaluate statements using the System One API. Use for structured label selection, ordered scoring, or yes/no-style evaluations when an API-based classification is appropriate.
---

# Classification with System One

Use System One for structured answers about a state, not for generating chat responses. The NaraRouter documentation shows `jev`, but the configured account returned `jev-1.14.0` from `/v1/models` and successfully accepted it. Model aliases can change or differ by provider and account: query `${SYSTEM_ONE_BASE_URL%/}/models` with the same Bearer key to discover available aliases instead of assuming `jev` is available.

## Configuration and safety

`SYSTEM_ONE_BASE_URL` and `SYSTEM_ONE_API_KEY` must both be set and non-empty. If either is missing, stop before calling the API and tell the user which variable needs configuration. Do not ask the user to paste a key into chat, or print, log, or commit it. If API classification is required, wait for configuration; if it is optional, offer manual classification and clearly distinguish it from an API result.

The state and questions are sent to an external service. Do not send secrets or sensitive data without appropriate authorization. Use the configured base URL only; do not silently substitute a provider.

## Request

Send `POST` to `${SYSTEM_ONE_BASE_URL%/}/systemone`, with `Authorization: Bearer <SYSTEM_ONE_API_KEY>` and `Content-Type: application/json`. The configured base URL includes `/v1`. System One does not stream.

Send a JSON object with `model`, `state`, and a `questions` object. Each question has a name, `type`, `instructions`, and, where applicable, `criteria`. Multiple questions can be sent together:

```json
{
  "model": "jev-1.14.0",
  "state": "The customer has waited three days for a refund.",
  "questions": {
    "intent": {
      "type": "choice",
      "instructions": "Classify the customer's issue.",
      "criteria": {"billing": "Billing or refund", "technical": "Technical issue"}
    },
    "severity": {
      "type": "score",
      "instructions": "Rate the severity of the issue.",
      "criteria": ["trivial", "minor", "major", "critical"]
    },
    "urgent": {
      "type": "noul",
      "instructions": "Does this message express urgency?"
    }
  }
}
```

- `choice`: select one label from up to 255 options in the `criteria` object. Read `choice`, `probabilities`, and `confidence` from the answer.
- `score`: rate on an ordered scale of 2–10 criteria. Read the weighted `score`, `legend`, `probabilities`, and `confidence`.
- `noul`: evaluate a statement; read `noul`, a value from 0 to 1. Confidence may be omitted.

The response's `answers` object preserves the question names. Treat scores and confidence as estimates, not certainty. Use a JSON serializer for dynamic input. Check HTTP status and response shape; report failures or missing answers without exposing credentials, and never fabricate API results. Keep retries bounded.

Source: https://router.bynara.id/docs (System One section).
