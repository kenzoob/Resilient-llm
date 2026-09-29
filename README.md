`resilient-llm`

> Une petite bibliothèque TypeScript qui rend les appels aux API de LLM fiables : timeout, réessais intelligents, circuit breaker, modèle de secours et streaming SSE. Publiée sur npm.

- **Durée :** 1 jour
- **Candidature ciblée :** AiMi. Leur annonce demande mot pour mot « making long-running LLM, agent, and SSE calls actually resilient (timeouts, retries, circuit breakers, fail-fast, recovery) ». Utile aussi pour Steuart.
- **Nom du dépôt :** `resilient-llm`
- **Nom npm :** `@kenzoob/resilient-llm` (un nom avec ton préfixe est toujours disponible)

---

## 1. Le problème qu'il résout

Les API de LLM échouent souvent : surcharge (erreur 429), panne temporaire (500, 503), réponse qui ne vient jamais. Sans protection, ton application attend indéfiniment, plante, ou continue de bombarder un service déjà en panne.

`resilient-llm` enveloppe n'importe quel appel et le rend robuste, sans dépendre d'un fournisseur précis.

## 2. Fonctionnalités

### Version minimale (obligatoire)

1. **Timeout** : chaque tentative est annulée après `timeoutMs` grâce à `AbortController`.
2. **Retry avec backoff exponentiel + jitter** : on réessaie seulement les erreurs temporaires (timeout, 429, 500 à 599). Jamais une erreur 400 ou 401. On respecte l'en-tête `Retry-After` s'il est présent.
3. **Circuit breaker** : après N échecs d'affilée, le circuit « s'ouvre » et les appels échouent immédiatement pendant un temps donné. Ensuite, un appel test est autorisé (état « half-open ») : s'il réussit, le circuit se referme.
4. **Fallback** : une liste de fournisseurs ou de modèles. Si le premier échoue définitivement, on passe au suivant.
5. **Hooks d'observabilité** : `onRetry`, `onCircuitOpen`, `onCircuitClose`, `onFallback`, pour brancher des logs ou des métriques.
6. **Adaptateurs** : Anthropic et OpenAI, en simple `fetch`, sans SDK.

### Bonus (si tu as le temps)

7. **Streaming SSE** : un générateur asynchrone qui lit une réponse en streaming et renvoie les morceaux de texte au fur et à mesure.
8. **Un exemple CLI** : `npx tsx examples/chat.ts "Explain RAG in one sentence"`, qui affiche la réponse en streaming.
9. **Un tableau d'état** : `breaker.getState()` renvoie l'état, le nombre d'échecs et la date de réouverture.

## 3. Stack

- TypeScript (mode strict), Node.js 22+
- **tsup** pour construire le paquet (formats ESM et CJS + fichiers de types)
- **Vitest** pour les tests, avec de faux timers pour tester les délais sans attendre
- **ESLint + Prettier**
- **GitHub Actions** pour la CI
- Aucune dépendance à l'exécution. C'est un argument à mettre dans le README.

## 4. Architecture

```
            ┌───────────────────────────────────────────────┐
 appel ───► │ resilientCall(options)                         │
            │                                               │
            │  pour chaque fournisseur (fallback) :         │
            │    ├─ circuit ouvert ? ──► passer au suivant  │
            │    └─ boucle de tentatives (retry) :          │
            │         ├─ timeout (AbortController)          │
            │         ├─ succès ──► breaker.success()       │
            │         └─ échec ───► breaker.failure()       │
            │               ├─ erreur temporaire : attendre │
            │               │  (backoff + jitter), réessayer│
            │               └─ erreur définitive : arrêter  │
            └───────────────────────────────────────────────┘
```

### Structure des fichiers

```
resilient-llm/
├── src/
│   ├── index.ts            # exports publics
│   ├── retry.ts            # withRetry + calcul du délai
│   ├── timeout.ts          # withTimeout
│   ├── circuit-breaker.ts  # classe CircuitBreaker
│   ├── fallback.ts         # resilientCall (orchestration)
│   ├── errors.ts           # LLMError, isRetryable(), parseRetryAfter()
│   ├── sse.ts              # parseSSE (bonus)
│   └── providers/
│       ├── anthropic.ts
│       └── openai.ts
├── test/                   # un fichier de test par module
├── examples/chat.ts
├── .github/workflows/ci.yml
├── .env.example
├── README.md
└── package.json
```

### L'API publique visée

Montre cet exemple à Claude Code : c'est ce que l'utilisateur de ta bibliothèque écrira.

```ts
import { resilientCall, CircuitBreaker, anthropic, openai } from "@kenzoob/resilient-llm";

const result = await resilientCall({
  providers: [
    anthropic({ apiKey: process.env.ANTHROPIC_API_KEY!, model: process.env.ANTHROPIC_MODEL! }),
    openai({ apiKey: process.env.OPENAI_API_KEY!, model: process.env.OPENAI_MODEL! }),
  ],
  messages: [{ role: "user", content: "Summarize this notice in one sentence: ..." }],
  timeoutMs: 20_000,
  retry: { retries: 3, baseDelayMs: 500, maxDelayMs: 8_000 },
  breaker: { failureThreshold: 5, resetTimeoutMs: 30_000 },
  hooks: {
    onRetry: ({ attempt, delayMs, error }) => console.warn(`retry #${attempt} in ${delayMs}ms`, error.message),
    onFallback: ({ from, to }) => console.warn(`falling back from ${from} to ${to}`),
  },
});

console.log(result.text, result.provider);
```

Les noms de modèles changent souvent : garde-les dans des variables d'environnement, jamais en dur dans le code.

### Les deux API, sans SDK

- **Anthropic :** `POST https://api.anthropic.com/v1/messages` avec les en-têtes `x-api-key`, `anthropic-version: 2023-06-01` et `content-type: application/json`. Le corps contient `model`, `max_tokens` et `messages`. Ajoute `"stream": true` pour recevoir du SSE.
- **OpenAI :** `POST https://api.openai.com/v1/chat/completions` avec l'en-tête `Authorization: Bearer <clé>`. Le corps contient `model` et `messages`. Même option `stream`.

Demande à Claude Code de vérifier ces détails dans la documentation officielle de chaque fournisseur avant de coder les adaptateurs.

## 5. Plan de travail avec Claude Code

Colle les prompts un par un. Relis, teste et fais un commit après chacun.

**Étape 0 : mise en place (30 min)**
```
Read SPEC.md and CLAUDE.md. Set up the project: TypeScript strict, tsup (ESM + CJS + d.ts), Vitest, ESLint, Prettier, and a GitHub Actions workflow that runs lint, typecheck and tests on Node 22. No runtime dependencies. Propose the plan first.
```
Commit : `chore: project setup`

**Étape 1 : erreurs et timeout (45 min)**
```
Implement src/errors.ts (an LLMError class with status and retryable fields, isRetryable() and parseRetryAfter() that supports both seconds and HTTP dates) and src/timeout.ts (withTimeout using AbortController). Write tests first, then the code. Explain each choice briefly.
```
Commit : `feat: errors and timeout`

**Étape 2 : retry (1 h)**
```
Implement src/retry.ts: withRetry(fn, options) with exponential backoff, full jitter, a maxDelayMs cap, Retry-After support, and an onRetry hook. Only retry retryable errors. Test it with Vitest fake timers: success after 2 failures, no retry on 400, stops after max retries, respects Retry-After.
```
Commit : `feat: retry with exponential backoff and jitter`

**Étape 3 : circuit breaker (1 h 30), à écrire toi-même en partie**

Commence par écrire toi-même la machine à états (closed → open → half-open), puis demande :
```
Review my CircuitBreaker implementation in src/circuit-breaker.ts. Point out bugs and edge cases, then write tests: opens after the threshold, fails fast while open, allows one trial call in half-open, closes after a success, reopens after a failure in half-open. Use fake timers.
```
Commit : `feat: circuit breaker`

**Étape 4 : adaptateurs et fallback (1 h 30)**
```
Implement src/providers/anthropic.ts and src/providers/openai.ts using fetch only. Check the current official API docs for request and response formats. Map HTTP errors to LLMError. Then implement resilientCall in src/fallback.ts that combines timeout, retry, breaker (one breaker per provider) and fallback, with hooks. Mock fetch in tests; never call real APIs in tests.
```
Commit : `feat: providers and fallback`

**Étape 5 : streaming SSE (bonus, 1 h)**
```
Implement src/sse.ts: an async generator that reads a fetch Response body stream, handles chunks split in the middle of an event, and yields parsed events. Add streamText() for both providers. Test with a fake ReadableStream split at awkward positions.
```
Commit : `feat: SSE streaming`

**Étape 6 : exemple, README, publication (1 h)**
```
Create examples/chat.ts that streams an answer using env vars. Write the README following the template in SPEC.md. Prepare package.json for publishing as @kenzoob/resilient-llm (files, exports, types, keywords, repository, license MIT).
```
Puis publie :
```bash
npm login
npm run build
npm publish --access public
```
Commit : `docs: README and example`

## 6. Tests à avoir (checklist)

- [ ] Un 200 renvoie le texte sans réessai
- [ ] Un 503 suivi d'un 200 réessaie une fois puis réussit
- [ ] Un 400 échoue tout de suite, sans réessai
- [ ] Un 429 avec `Retry-After: 2` attend 2 secondes
- [ ] Un timeout déclenche un réessai
- [ ] Le circuit s'ouvre après le seuil d'échecs et renvoie une erreur immédiate
- [ ] Le circuit passe en half-open après le délai, puis se referme après un succès
- [ ] Le fallback passe au 2e fournisseur quand le 1er est épuisé
- [ ] Le parseur SSE gère un événement coupé en deux morceaux

## 7. Modèle de README (en anglais)

````markdown
# resilient-llm

![CI](https://github.com/kenzoob/resilient-llm/actions/workflows/ci.yml/badge.svg)
![npm](https://img.shields.io/npm/v/@kenzoob/resilient-llm)

Make LLM API calls production-ready: timeouts, retries with backoff and jitter, circuit breakers, provider fallback and SSE streaming. Zero runtime dependencies.

## Why
LLM APIs fail in predictable ways: rate limits (429), temporary outages (5xx) and hanging requests. Without protection, your app waits forever, crashes, or keeps hammering a service that is already down.

## Install
```bash
npm install @kenzoob/resilient-llm
```

## Quick start
(the code example from section 4)

## How it works
- **Timeout**: each attempt is aborted with AbortController.
- **Retry**: only transient errors (timeouts, 429, 5xx), exponential backoff with full jitter, honors Retry-After.
- **Circuit breaker**: closed → open after N failures → half-open trial → closed.
- **Fallback**: tries the next provider when one is exhausted or its circuit is open.

(diagram)

## Design decisions
- Why full jitter: avoids many clients retrying at the same moment.
- Why one breaker per provider: one failing provider should not block the others.
- Why no SDK: fewer dependencies, full control over errors and streaming.

## Development
```bash
npm install
npm test
```

## License
MIT
````

## 8. Préparation entretien

**Présentation en 30 secondes :**
> I built resilient-llm, a small TypeScript library that makes LLM API calls reliable. It adds timeouts, retries with exponential backoff and jitter, a circuit breaker, and fallback between providers like Anthropic and OpenAI. It also parses SSE streams. It has no runtime dependencies, it's fully tested with fake timers, and it's published on npm.

**Questions probables :**

- **Why jitter?** « If many clients fail at the same time and retry after exactly the same delay, they all hit the server again together. Random jitter spreads the retries out. »
- **Why not retry a 400?** « A 400 means the request itself is wrong. Sending it again will fail again, and it wastes time and money. »
- **What is half-open?** « After the reset timeout, the breaker lets one trial call through. If it succeeds, the circuit closes. If it fails, it opens again. »
- **How did you test the delays?** « With Vitest fake timers. I advance the clock manually, so the tests are fast and deterministic. »
- **What would you add next?** « Metrics export, a token budget per request, and idempotency keys for operations that must not run twice. »

## 9. Après le projet

- Épingle le dépôt, ajoute-le à ton README de profil.
- **Mail AiMi :** ajoute la ligne « I recently published resilient-llm, a TypeScript library for timeouts, retries, circuit breakers and SSE streaming on LLM calls: [lien] ».
- **CV → Technical projects :** « resilient-llm | npm package – TypeScript (2026): timeouts, retries with backoff, circuit breaker and SSE streaming for LLM APIs; zero dependencies, fully tested. »