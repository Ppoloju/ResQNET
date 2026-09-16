# IQOO AI Architecture

## Policy (§61)

Small, free, offline, honest. No huge model downloads; nothing that pretends to
be production-ready when it is not. The AI runs **entirely on-device** — no
internet, no cloud calls, no data leaving the phone.

## Current engine: `iqoo-rules-v1` (shared/src/ai.ts)

A deterministic rule-based classifier — genuinely useful, fully testable,
zero-dependency, works on any hardware:

| Input | Signals |
|---|---|
| Text (typed or voice transcript) | keyword/phrase groups per category (MEDICAL, FIRE, ACCIDENT, PERSONAL_SAFETY, NATURAL_DISASTER, …), severity ladders (CRITICAL/HIGH/MEDIUM phrase sets) |
| `saysImmobile` flag (voice hint / checkbox) | forces CRITICAL + MEDICAL |
| Battery context | recorded as signal, never inflates category |
| No usable text | "no-text-fallback" → at least HIGH (an SOS always rates urgency) |

Output (`AIResult`): `category`, `severity`, `confidence` (0.55-0.95 band),
`recommendedAction` (e.g. MEDICAL_ASSISTANCE, FIRE_BRIGADE), `matched` signals,
`engine: 'iqoo-rules-v1'`.

## Voice (§16)

Microphone **never** starts without an explicit user press; a persistent
RECORDING indicator with a STOP button is shown for the whole capture; Web
Speech API when the browser offers it, typed input always works as a full
fallback. Nothing is uploaded — the transcript is classified locally.

## How it joins the emergency

`startSos(message?, ai?)` attaches the AI result to the packet (`packet.ai`) —
travelling with the emergency so responders see the classification with its
confidence and matched signals. It is advisory: the SOS itself does not depend
on the AI succeeding.

## Privacy rules

- Classification happens after user action, on text the user provided for this
  purpose; no ambient listening, no background analysis.
- The AI result is an assistance signal, **never a diagnosis** (disclaimer shown
  in the UI and carried in `AI_DISCLAIMER`).
- Matched signals are transparency, not opacity — the user sees why the AI
  decided what it decided.

## Upgrade path

`LocalAIEngine` is an interface (`name`, `classify(input): AIResult`). A
quantized on-device model (Gemini Nano in Chrome, MediaPipe LLM Inference on
Android) can implement the same interface and drop in — UI, packet schema and
tests unchanged. Any engine must remain: small (≤ few hundred MB), quantized,
open-weights or OS-provided, fully offline, mobile-compatible — otherwise it is
labelled `[P]`/`[R]` honestly rather than shipped as fake capability.

## Test coverage

`shared/src/ai.test.ts`: CRITICAL medical, immobility override, fire /
personal-safety categories, neutral text, no-text fallback, battery-context
non-inflation, determinism.
