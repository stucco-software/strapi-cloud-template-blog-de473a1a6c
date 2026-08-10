# Plan 7: Contact capture, and reconciling `chapter.partners`

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture contact submissions for real — on the national form and on chapter microsites — so the admin screen plan 3 built finally has data; and remove `chapter.partners` before it diverges from the component the public site actually renders.

**Architecture:** A single bespoke public endpoint, `POST /api/form-submissions/capture`, that never trusts the client for the chapter. The client sends the page's `documentId`; the server resolves the page, reads its `shared.contact-form` component, validates the submitted keys against that component's configured `fields`, and derives `chapter` from the page's own relation. Spam is handled without an external dependency: a honeypot field, a minimum fill time, and a per-IP sliding window. `chapter.partners` and its `partner.chapters` inverse are dropped outright — nothing reads them, and they agree with the component exactly today, so nothing is lost.

**Tech Stack:** Strapi 5.45.1 (CJS services, documents API), Astro 6.4.2 (SSR, `experimental_AstroContainer` for render tests), Vitest, supertest.

---

## Why this plan exists

Two findings from the plan 4 status review, both quoted from that report:

> **The contact form still sends nothing.** `docs/2026-08-04-contact-form-sends-nothing.md`. Every enquiry since launch has been discarded while the visitor was told "your message is on its way." The admin side is built and tested; only public capture is missing. This is the only item on this list that is actively harming someone.

> **`chapter.partners` will now diverge.** `seed.js:261` populates it and `chapters_partners_lnk` holds 12 rows, but the microsite reads the component. After plan 4, a chapter admin's save updates one and not the other. Two stores, one authoritative, one that looks it.

They are independent subsystems and are deliberately kept in separate chunks. **Chunk 5 (partners) can ship on its own, before or after everything else** — it touches no file the other chunks touch. If only one thing gets done, do Chunk 5: it is roughly an hour and it closes a window that is currently open.

---

## Scope

**In:**

- A public capture endpoint that whitelists fields, derives the chapter server-side, and resists casual spam.
- The national `/contact` and `/account/chapter-support` forms actually posting — and telling the truth when they fail.
- Rendering `shared.contact-form` on chapter microsites from its configured fields. **Six component slots are configured on three chapter home pages and render nothing today**, because `PageBody.astro` has no case for them. This is the only surface that can ever feed the chapter admin submissions screen.
- Dropping `chapter.partners` and `partner.chapters`, the seed line that writes it, and the 12 link rows.

**Not in:**

- **Email notification.** `shared.contact-form` has a `notificationEmails` field and there is **no email provider configured at all** (`config/` has no `plugins.js` mail entry, no provider installed). Wiring delivery means choosing a provider, credentials, templates, bounce handling and a retry story. Named as a limitation, deliberately not smuggled in.
- **reCAPTCHA.** Decided against for this plan: it needs keys provisioned, adds a network call to every submit, and degrades badly with JavaScript disabled — which every other form in this system survives. The endpoint is structured so adding it later is additive.
- **A national submissions screen.** Submissions from `/contact` have no chapter, so no chapter admin sees them. For now the Strapi admin panel is the national inbox. Named as a limitation.
- **`shared.form-field` type `checkbox`.** The CMS enum allows it; `FormField.astro` has no `checkbox` case. Chunk 4 renders the five types both sides support and **skips `checkbox` loudly** rather than rendering a broken control.

---

## Preconditions

**1. Branch.** Trunk-based; commit to `main` in both repos as previous plans did.

**2. Baselines, measured immediately before writing this plan.**

| | Tests | Files |
|---|---|---|
| `areaa-cms` | **175** | 15 |
| `areaa-frontend` | **75** | 10 |

`api::chapter-admin%` permissions: **23**. Public-role permissions: **28**.

**3. Every CMS command needs `cd /Users/nk/Projects/AREAA/areaa-cms`** and every frontend command `cd /Users/nk/Projects/AREAA/areaa-frontend`. A missing `cd` in plan 4 made the headline gate run the wrong repo's suite. Assume nothing about the inherited directory.

**4. `PATH="/opt/homebrew/bin:$PATH"`** on CMS test/boot commands (sqlite3).

**5. Test accounts.** `chapadmin@areaa.test` / `Password123!` administers `aloha-hawaii`. `twochapter@areaa.test` administers `aloha-hawaii` and `greater-chicago`. Any new user **must** carry `provider: 'local'` and `confirmed: true` or it cannot log in.

**6. Astro form POSTs need an `Origin` header** matching the dev host when driven by curl — `checkOrigin` is on, and this is the CSRF protection. A missing Origin gives 403, not a validation error.

**7. `.tmp/data.db` is untracked.** `git status` cannot see data damage. Chunk 5 deletes rows; snapshot first.

---

## Verified assumptions

Executed against the installed Strapi 5.45.1 and the seeded database on 2026-08-10.

| Assumption | Verdict |
|---|---|
| `form_submissions` holds **0 rows** | ✅ Confirmed. Nothing has ever been captured. |
| `api::form-submission` exists with `chapter`, `page`, `data` (json), `submittedAt`, `handled` | ✅ Per schema; `draftAndPublish: false`, so there is one row per submission and no status juggling |
| Its controller/router/service are **untouched `createCore*` factories** | ✅ So the default router already exposes find/findOne/create/update/delete — granting Public `create` would let a spammer set `handled: true` or pick any `chapter`. This is why Chunk 2 adds a bespoke action instead. |
| **No** role currently holds any `form-submission` permission | ✅ Zero rows matching `%form-submission%` in `up_permissions` |
| `shared.contact-form` exists, with `title`, `intro`, `fields` (repeatable `shared.form-field`), `submitLabel`, `notificationEmails` | ✅ Per component schema |
| It is configured on **6 page slots** — the home page of `aloha-hawaii`, `greater-chicago` and `boston`, at both statuses | ✅ cmp_ids 25–30 |
| **`PageBody.astro` has no `shared.contact-form` case**, so all six render nothing | ✅ Its switch handles 7 types; contact-form is not among them, and `default:` returns null |
| `content.ts` already populates `"shared.contact-form": { populate: { fields: true } }` | ✅ So the data reaches the renderer; only the dispatch is missing |
| `ContactFormComponent` in `strapi.ts:176` is a **stub** — `__component` and `id` only | ✅ Needs the real shape before it can be rendered |
| `ContactForm.astro` `preventDefault()`s and shows "your message is on its way" | ✅ Lines 53–57 and 37 |
| It is used on `/contact` and `/account/chapter-support`, and **neither passes a chapter** | ✅ Both render `<ContactForm />` with at most an `intro` |
| `listSubmissions` filters on `chapter.documentId` | ✅ So a submission with no chapter is invisible to **every** chapter admin |
| `shared.form-field` enum is text/email/tel/textarea/select/checkbox | ✅ `FormField.astro` supports all but `checkbox` |
| **No email provider is configured** | ✅ `config/` holds admin, api, database, middlewares, plugins, server — no mail entry |
| `chapter.partners` is `manyToMany → api::partner.partner`, `inversedBy: chapters` | ✅ And `partner.chapters` is the inverse |
| `chapters_partners_lnk` holds **12 rows** — 2 per chapter × 3 chapters × draft+published | ✅ `pdx` has none |
| **Nothing reads `chapter.partners`** in either repo | ✅ The only `partners?: Partner[]` in `strapi.ts` is on `PartnerGroupComponent` (line 130), not `Chapter`. No CMS reader outside `seed.js:261`. |
| `chapter.partners` and the partner-group component **agree exactly today** | ✅ aloha `Chase, Bank of America`; boston `Bank of America, Rocket Mortgage`; chicago `Citi, Wells Fargo` — identical both sides. **The divergence is prospective**, starting at the first save through plan 4's screen. Dropping now loses nothing. |
| `seed.js:261` is `partners: a.partners.map((i) => partners[i].documentId),` | ✅ Inside the chapter update at 255–263 |
| Astro `checkOrigin` rejects a form POST with no matching `Origin` | ✅ Reproduced: 403 on `/api/login` without it, 303 with it |

---

## Chunk 1: The capture service

Pure functions first, with no Strapi and no network, so the rules are testable and the endpoint stays thin.

### Task 1: Field validation and shaping

**Files:** Create `src/api/form-submission/services/capture.js`, `tests/unit/capture.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

// One createRequire so BadInputError is the SAME class the service throws —
// an ESM import beside a CJS require gives Vitest two class objects.
const require = createRequire(import.meta.url);
const {
  shapeSubmission, NATIONAL_FIELDS, MAX_VALUE_LEN, MAX_FIELDS,
} = require('../../src/api/form-submission/services/capture.js');
const { BadInputError } = require('../../src/api/chapter-admin/services/fields.js');

const field = (name, type = 'text', required = false) => ({ name, label: name, type, required });
const CONFIG = [
  field('firstName', 'text', true),
  field('email', 'email', true),
  field('message', 'textarea', true),
  field('phone', 'tel'),
];

describe('shapeSubmission', () => {
  it('keeps exactly the configured fields', () => {
    expect(shapeSubmission({ firstName: 'Jane', email: 'j@x.com', message: 'Hi' }, CONFIG))
      .toEqual({ firstName: 'Jane', email: 'j@x.com', message: 'Hi' });
  });

  it('DROPS keys the form never declared', () => {
    // The whole reason this is not the core `create`: a client that can name
    // its own keys can send `handled` or `chapter`.
    const out = shapeSubmission(
      { firstName: 'Jane', email: 'j@x.com', message: 'Hi', handled: true, chapter: 'boston' },
      CONFIG);
    expect(out).not.toHaveProperty('handled');
    expect(out).not.toHaveProperty('chapter');
  });

  it('400s when a required field is missing', () => {
    expect(() => shapeSubmission({ firstName: 'Jane', email: 'j@x.com' }, CONFIG))
      .toThrow(BadInputError);
  });

  it('400s when a required field is present but blank', () => {
    // An empty textarea posts '' rather than being absent.
    expect(() => shapeSubmission({ firstName: 'Jane', email: 'j@x.com', message: '   ' }, CONFIG))
      .toThrow(BadInputError);
  });

  it('omits optional fields left empty rather than storing empty strings', () => {
    const out = shapeSubmission({ firstName: 'Jane', email: 'j@x.com', message: 'Hi', phone: '' }, CONFIG);
    expect(out).not.toHaveProperty('phone');
  });

  it('trims values', () => {
    expect(shapeSubmission({ firstName: '  Jane  ', email: 'j@x.com', message: 'Hi' }, CONFIG).firstName)
      .toBe('Jane');
  });

  it('rejects a value longer than the cap rather than truncating it', () => {
    // Truncating would store a message the visitor did not write and did not
    // consent to; better to refuse and let them shorten it.
    const long = 'x'.repeat(MAX_VALUE_LEN + 1);
    expect(() => shapeSubmission({ firstName: 'Jane', email: 'j@x.com', message: long }, CONFIG))
      .toThrow(BadInputError);
  });

  it('rejects an absurd number of keys before doing per-key work', () => {
    const many = {};
    for (let i = 0; i < MAX_FIELDS + 1; i += 1) many[`k${i}`] = 'v';
    expect(() => shapeSubmission(many, CONFIG)).toThrow(BadInputError);
  });

  it('rejects a non-object payload', () => {
    for (const bad of [null, 'nope', 42, []]) {
      expect(() => shapeSubmission(bad, CONFIG)).toThrow(BadInputError);
    }
  });

  it('rejects a nested object as a value', () => {
    // `data` is a JSON column; nesting would render as [object Object] on the
    // admin screen, which stringifies but does not flatten.
    expect(() => shapeSubmission(
      { firstName: { a: 1 }, email: 'j@x.com', message: 'Hi' }, CONFIG)).toThrow(BadInputError);
  });

  it('validates an email field actually looks like an email', () => {
    expect(() => shapeSubmission({ firstName: 'J', email: 'not-an-email', message: 'Hi' }, CONFIG))
      .toThrow(BadInputError);
  });

  it('falls back to the national field set when a form has no configured fields', () => {
    // /contact has no page component behind it.
    const out = shapeSubmission(
      { firstName: 'Jane', lastName: 'Doe', email: 'j@x.com', message: 'Hi' }, NATIONAL_FIELDS);
    expect(Object.keys(out).sort()).toEqual(['email', 'firstName', 'lastName', 'message']);
  });

  it('skips a checkbox field rather than rendering or storing it wrong', () => {
    // FormField.astro has no checkbox case; see "Not in this plan".
    const cfg = [...CONFIG, field('optIn', 'checkbox')];
    const out = shapeSubmission(
      { firstName: 'J', email: 'j@x.com', message: 'Hi', optIn: 'on' }, cfg);
    expect(out).not.toHaveProperty('optIn');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && PATH="/opt/homebrew/bin:$PATH" \
  npx vitest run tests/unit/capture.test.js
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```js
'use strict';

const { BadInputError } = require('../../chapter-admin/services/fields');

/** Per-value character cap. A textarea is the only field anyone writes prose in. */
const MAX_VALUE_LEN = 5000;
/** Total keys accepted before we stop looking. Guards against a JSON bomb. */
const MAX_FIELDS = 40;

/**
 * The shape `/contact` posts. It has no page behind it, so no component
 * configures its fields — this is the fallback, and it is deliberately fixed
 * rather than client-supplied.
 */
const NATIONAL_FIELDS = [
  { name: 'firstName', label: 'First Name', type: 'text', required: true },
  { name: 'lastName', label: 'Last Name', type: 'text', required: true },
  { name: 'email', label: 'Email', type: 'email', required: true },
  { name: 'message', label: 'Message', type: 'textarea', required: true },
];

// Deliberately permissive. A stricter pattern rejects addresses that are valid
// under RFC 5322, and refusing a real enquiry is worse than storing a typo.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** `checkbox` is in the CMS enum but FormField.astro cannot render it. */
const RENDERABLE = new Set(['text', 'email', 'tel', 'textarea', 'select']);

/**
 * Raw submitted values -> the object stored in `form_submission.data`.
 *
 * Driven by the form's OWN configured fields, never by the payload's keys. This
 * is the difference between this endpoint and the core `create` it deliberately
 * does not use: the core create would happily accept `handled: true` from a
 * spammer wanting to hide their own submission, or a `chapter` of their
 * choosing. Here a key that no field declares simply does not survive.
 *
 * @param {object} raw     what the form posted
 * @param {Array}  fields  the component's `fields`, or NATIONAL_FIELDS
 */
function shapeSubmission(raw, fields) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new BadInputError('Submission must be a set of form values');
  }
  if (Object.keys(raw).length > MAX_FIELDS) {
    throw new BadInputError('Too many form values');
  }

  const out = {};
  for (const field of fields) {
    if (!RENDERABLE.has(field.type)) continue;   // checkbox: not rendered, not stored

    const value = raw[field.name];
    if (value !== undefined && (typeof value === 'object' || Array.isArray(value))) {
      throw new BadInputError(`${field.label} is not a valid value`);
    }

    const text = value === undefined || value === null ? '' : String(value).trim();

    if (text === '') {
      if (field.required) throw new BadInputError(`${field.label} is required`);
      continue;                                   // omit, do not store ''
    }
    if (text.length > MAX_VALUE_LEN) {
      throw new BadInputError(`${field.label} is too long`);
    }
    if (field.type === 'email' && !EMAIL.test(text)) {
      throw new BadInputError(`${field.label} does not look like an email address`);
    }
    out[field.name] = text;
  }
  return out;
}

module.exports = { shapeSubmission, NATIONAL_FIELDS, MAX_VALUE_LEN, MAX_FIELDS };
```

- [ ] **Step 4: Run it and watch it pass**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && PATH="/opt/homebrew/bin:$PATH" \
  npx vitest run tests/unit/capture.test.js
```

Expected: PASS, **13 tests**.

- [ ] **Step 5: Commit**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && \
  git add src/api/form-submission/services/capture.js tests/unit/capture.test.js && \
  git commit -m "feat: contact submission field validation driven by the form's own config"
```

---

### Task 2: Spam resistance

Three cheap checks, none of which needs a key or a third party. **None of them is a strong guarantee** and the plan says so where it matters.

**Files:** Create `src/api/form-submission/services/spam.js`, `tests/unit/spam.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  isHoneypotTripped, isTooFast, RateLimiter, HONEYPOT_FIELD, MIN_FILL_MS,
} = require('../../src/api/form-submission/services/spam.js');

describe('honeypot', () => {
  it('passes when the trap field is absent', () => {
    expect(isHoneypotTripped({})).toBe(false);
  });

  it('passes when the trap field is present but empty', () => {
    // Browsers post empty hidden inputs; that is the NORMAL case, not a bot.
    expect(isHoneypotTripped({ [HONEYPOT_FIELD]: '' })).toBe(false);
  });

  it('trips when the trap field is filled', () => {
    expect(isHoneypotTripped({ [HONEYPOT_FIELD]: 'http://spam.example' })).toBe(true);
  });

  it('does NOT trip on whitespace alone', () => {
    // A browser or extension padding the field must not cost a real visitor
    // their enquiry; only actual content counts as a bot filling it in.
    expect(isHoneypotTripped({ [HONEYPOT_FIELD]: '   ' })).toBe(false);
  });
});

describe('isTooFast', () => {
  const now = 1_700_000_000_000;

  it('accepts a form filled at human speed', () => {
    expect(isTooFast(String(now - 30_000), now)).toBe(false);
  });

  it('rejects one submitted faster than any human could type', () => {
    expect(isTooFast(String(now - 100), now)).toBe(true);
  });

  it('accepts a missing timestamp rather than blocking the submission', () => {
    // A stale cached page, or a browser that stripped the field. Refusing a
    // real enquiry is worse than accepting a possible bot — the honeypot and
    // the rate limit still apply.
    expect(isTooFast(undefined, now)).toBe(false);
  });

  it('accepts a garbage timestamp for the same reason', () => {
    expect(isTooFast('not-a-number', now)).toBe(false);
  });

  it('accepts a very old timestamp — a slow writer is not a bot', () => {
    expect(isTooFast(String(now - 6 * 60 * 60 * 1000), now)).toBe(false);
  });

  it('rejects a timestamp from the future', () => {
    expect(isTooFast(String(now + 60_000), now)).toBe(true);
  });
});

describe('RateLimiter', () => {
  it('allows submissions up to the limit', () => {
    const rl = new RateLimiter({ limit: 3, windowMs: 60_000 });
    let t = 1000;
    for (let i = 0; i < 3; i += 1) expect(rl.allow('1.2.3.4', t++)).toBe(true);
  });

  it('blocks the one after', () => {
    const rl = new RateLimiter({ limit: 3, windowMs: 60_000 });
    let t = 1000;
    for (let i = 0; i < 3; i += 1) rl.allow('1.2.3.4', t++);
    expect(rl.allow('1.2.3.4', t)).toBe(false);
  });

  it('keeps buckets per IP', () => {
    const rl = new RateLimiter({ limit: 1, windowMs: 60_000 });
    expect(rl.allow('1.1.1.1', 1000)).toBe(true);
    expect(rl.allow('2.2.2.2', 1000)).toBe(true);
    expect(rl.allow('1.1.1.1', 1001)).toBe(false);
  });

  it('lets the window slide', () => {
    const rl = new RateLimiter({ limit: 1, windowMs: 1000 });
    expect(rl.allow('1.1.1.1', 1000)).toBe(true);
    expect(rl.allow('1.1.1.1', 1500)).toBe(false);
    expect(rl.allow('1.1.1.1', 2100)).toBe(true);
  });

  it('treats a missing IP as one shared bucket rather than skipping the limit', () => {
    // If the IP cannot be read, the safe reading is "everyone is one caller",
    // not "no limit applies".
    const rl = new RateLimiter({ limit: 1, windowMs: 60_000 });
    expect(rl.allow(undefined, 1000)).toBe(true);
    expect(rl.allow(undefined, 1001)).toBe(false);
  });

  it('evicts stale buckets so the map cannot grow without bound', () => {
    const rl = new RateLimiter({ limit: 5, windowMs: 1000 });
    for (let i = 0; i < 50; i += 1) rl.allow(`10.0.0.${i}`, 1000);
    expect(rl.size()).toBe(50);
    rl.allow('10.1.1.1', 100_000);          // far outside every window
    expect(rl.size()).toBe(1);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && PATH="/opt/homebrew/bin:$PATH" \
  npx vitest run tests/unit/spam.test.js
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```js
'use strict';

/**
 * Cheap spam resistance with no external dependency.
 *
 * None of this is a strong guarantee. A determined attacker reads the HTML,
 * omits the honeypot, forges the timestamp and rotates IPs. What these do is
 * raise the cost above "point a generic form-spam script at it", which is the
 * traffic a small association site actually gets. reCAPTCHA was considered and
 * deferred: it needs provisioned keys and degrades badly without JavaScript,
 * which every other form in this system survives.
 */

/** Named to look worth filling in. Real users never see it. */
const HONEYPOT_FIELD = 'website';

/** Below this, nobody typed a name, an email and a message. */
const MIN_FILL_MS = 2500;

const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 10 * 60 * 1000;

function isHoneypotTripped(raw) {
  const v = raw?.[HONEYPOT_FIELD];
  return typeof v === 'string' && v.trim() !== '';
}

/**
 * @param {string|undefined} renderedAt  ms epoch the form was rendered
 * @param {number}           now         ms epoch now
 *
 * Absent or unparseable => NOT too fast. A stale cached page or a stripped
 * field must not cost someone their enquiry; the honeypot and rate limit still
 * apply. A future timestamp is rejected, because that only happens deliberately.
 */
function isTooFast(renderedAt, now) {
  const then = Number(renderedAt);
  if (!Number.isFinite(then) || then <= 0) return false;
  if (then > now) return true;
  return now - then < MIN_FILL_MS;
}

/**
 * Per-IP sliding window, in memory.
 *
 * IN MEMORY IS THE LIMITATION. It resets on restart and is per-process, so a
 * multi-instance deploy gets `limit x instances`. Moving to Redis is the fix
 * when there is more than one instance; until then this is honest and free.
 */
class RateLimiter {
  constructor({ limit = RATE_LIMIT, windowMs = RATE_WINDOW_MS } = {}) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.hits = new Map();
  }

  allow(ip, now) {
    // A missing IP collapses to one shared bucket. The alternative — skipping
    // the check — turns "we could not identify the caller" into "no limit".
    const key = ip || '__unknown__';
    const cutoff = now - this.windowMs;

    for (const [k, times] of this.hits) {
      const live = times.filter((t) => t > cutoff);
      if (live.length === 0) this.hits.delete(k);
      else this.hits.set(k, live);
    }

    const times = this.hits.get(key) ?? [];
    if (times.length >= this.limit) return false;
    times.push(now);
    this.hits.set(key, times);
    return true;
  }

  size() { return this.hits.size; }
}

module.exports = {
  isHoneypotTripped, isTooFast, RateLimiter,
  HONEYPOT_FIELD, MIN_FILL_MS, RATE_LIMIT, RATE_WINDOW_MS,
};
```

- [ ] **Step 4: Run it and watch it pass**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && PATH="/opt/homebrew/bin:$PATH" \
  npx vitest run tests/unit/spam.test.js
```

Expected: PASS, **16 tests** — 4 honeypot, 6 timing, 6 rate limiter.

Note the eviction test asserts `size()` before and after, so a no-op eviction fails it.

- [ ] **Step 5: Commit**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && \
  git add src/api/form-submission/services/spam.js tests/unit/spam.test.js && \
  git commit -m "feat: honeypot, fill-timing and per-IP rate limiting for public capture"
```

---

## Chunk 2: The public endpoint

### Task 3: `POST /api/form-submissions/capture`

**Files:** Modify `src/api/form-submission/controllers/form-submission.js`, `src/api/form-submission/routes/form-submission.js`; create `src/api/form-submission/routes/capture.js`

- [ ] **Step 1: A custom route file, leaving the core router alone**

The core router stays as-is and stays ungranted. Add a **separate** route file — Strapi loads every file in `routes/`:

```js
'use strict';

// A bespoke public route, deliberately NOT the core router's `create`.
// The core create accepts arbitrary attributes, so granting it to Public would
// let a spammer POST `handled: true` to hide their own submission, or attribute
// it to any chapter. This action accepts form values only and derives the
// chapter server-side.
module.exports = {
  routes: [
    {
      method: 'POST',
      path: '/form-submissions/capture',
      handler: 'form-submission.capture',
      config: { auth: false },   // public by design; see the guards in the handler
    },
  ],
};
```

`auth: false` makes it reachable without a JWT. It does **not** make it unguarded — the honeypot, timing, rate limit and field whitelist all still run.

- [ ] **Step 2: The controller**

```js
'use strict';

const { createCoreController } = require('@strapi/strapi').factories;
const { BadInputError } = require('../../chapter-admin/services/fields');
const { shapeSubmission, NATIONAL_FIELDS } = require('../services/capture');
const { isHoneypotTripped, isTooFast, RateLimiter } = require('../services/spam');

// One limiter for the process lifetime. See the class comment for why in-memory
// is a real limitation rather than a shortcut.
const limiter = new RateLimiter();

/**
 * Resolve the form's field configuration AND its owning chapter from the page.
 *
 * The client sends a page documentId, never a chapter. That is the whole point:
 * the chapter is derived from the page's own relation, so a caller cannot file
 * an enquiry against a chapter of their choosing. Requiring the page to
 * actually carry a contact-form component closes the remaining gap — a random
 * page documentId resolves to no form and is refused.
 */
async function resolveForm(strapiInstance, pageDocumentId) {
  if (!pageDocumentId) {
    // The national /contact form. No page, no chapter, fixed field set.
    return { fields: NATIONAL_FIELDS, chapterDocumentId: null, pageDocumentId: null };
  }

  const page = await strapiInstance.documents('api::page.page').findOne({
    documentId: pageDocumentId,
    populate: { chapter: { fields: ['slug'] }, components: { populate: { fields: true } } },
    status: 'published',   // only a LIVE page can receive a submission
  });
  if (!page) return { error: 'no-such-page' };

  const form = (page.components ?? []).find((c) => c.__component === 'shared.contact-form');
  if (!form) return { error: 'no-contact-form' };

  return {
    fields: form.fields ?? [],
    chapterDocumentId: page.chapter?.documentId ?? null,
    pageDocumentId: page.documentId,
  };
}

module.exports = createCoreController('api::form-submission.form-submission', ({ strapi }) => ({
  async capture(ctx) {
    const input = ctx.request.body?.data ?? ctx.request.body ?? {};
    const now = Date.now();

    // Honeypot and timing both return 200 with no record written. Telling a bot
    // WHY it failed is free tuning information; a human never reaches here.
    if (isHoneypotTripped(input) || isTooFast(input.renderedAt, now)) {
      ctx.body = { data: { received: true } };
      return;
    }

    const ip = ctx.request.ip;
    if (!limiter.allow(ip, now)) {
      ctx.status = 429;
      ctx.body = { error: { message: 'Too many messages. Please try again shortly.' } };
      return;
    }

    const resolved = await resolveForm(strapi, input.pageDocumentId);
    if (resolved.error) return ctx.notFound('That form is no longer available');

    let data;
    try {
      data = shapeSubmission(input.values ?? {}, resolved.fields);
    } catch (err) {
      if (err instanceof BadInputError) return ctx.badRequest(err.message);
      throw err;
    }

    // A form configured with zero renderable fields would store {} forever.
    if (Object.keys(data).length === 0) {
      return ctx.badRequest('That form has no fields to submit');
    }

    const record = await strapi.documents('api::form-submission.form-submission').create({
      data: {
        data,
        submittedAt: new Date(now).toISOString(),
        handled: false,          // set here, never from the payload
        ...(resolved.chapterDocumentId
          ? { chapter: { documentId: resolved.chapterDocumentId } } : {}),
        ...(resolved.pageDocumentId
          ? { page: { documentId: resolved.pageDocumentId } } : {}),
      },
    });

    // Deliberately thin: the caller is the public, and a submission id is not
    // theirs to have.
    ctx.body = { data: { received: true } };
    strapi.log.info(`form-submission captured ${record.documentId}`);
  },
}));
```

- [ ] **Step 3: Grant it to Public, and to nobody else**

`grants.js` owns chapter-admin actions only, so this grant belongs with the bootstrap that manages the Public role. Add to whichever bootstrap block seeds public permissions — **and grant only `capture`**:

```js
  'api::form-submission.form-submission.capture',
```

Do **not** grant `create`, `find`, `findOne`, `update` or `delete` on this type to Public. `find` would expose every enquiry the association has ever received.

- [ ] **Step 4: Boot and confirm the grant landed**

Two commands, separately — chaining with `;` lets a failure scroll past under Strapi's boot output:

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && pkill -f "strapi develop" ; \
  PATH="/opt/homebrew/bin:$PATH" node scripts/boot-once.js
cd /Users/nk/Projects/AREAA/areaa-cms && \
  sqlite3 .tmp/data.db "SELECT p.action FROM up_permissions p JOIN up_permissions_role_lnk l ON l.permission_id=p.id JOIN up_roles r ON r.id=l.role_id WHERE r.type='public' AND p.action LIKE '%form-submission%';"
```

Expected: `BOOTSTRAP OK`, then exactly one row — `api::form-submission.form-submission.capture`. Public permissions go **28 → 29**.

- [ ] **Step 5: Commit**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && \
  git add src/api/form-submission/ src/index.js && \
  git commit -m "feat: public POST /form-submissions/capture, chapter derived from the page"
```

---

### Task 4: Integration-test the endpoint

**Files:** Create `tests/integration/capture.test.js`

- [ ] **Step 1: Write the tests**

```js
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { boot, shutdown } from './helpers.js';

const RUN = Date.now();
let strapi, chapterPage, chapterSlug;

// Old enough to clear MIN_FILL_MS on every request.
const human = () => String(Date.now() - 30_000);

beforeAll(async () => {
  strapi = await boot();

  // A REAL published chapter home page carrying a contact-form component.
  // Asserted, not skipped: cmp_ids 25-30 sit on three chapter home pages, and
  // if that stops being true this suite must fail loudly rather than pass.
  const pages = await strapi.documents('api::page.page').findMany({
    filters: { slug: 'home' },
    populate: { chapter: { fields: ['slug'] }, components: { populate: { fields: true } } },
    status: 'published', limit: -1,
  });
  chapterPage = pages.find((p) =>
    p.chapter && (p.components ?? []).some((c) => c.__component === 'shared.contact-form'));
  expect(chapterPage).toBeTruthy();
  chapterSlug = chapterPage.chapter.slug;
});

afterAll(async () => {
  try {
    const junk = await strapi.documents('api::form-submission.form-submission')
      .findMany({ limit: -1 });
    for (const r of junk) {
      const blob = JSON.stringify(r.data ?? {});
      if (blob.includes(String(RUN))) {
        await strapi.documents('api::form-submission.form-submission')
          .delete({ documentId: r.documentId });
      }
    }
  } finally {
    await shutdown();
  }
});

const api = () => request(strapi.server.httpServer);
const post = (body) => api().post('/api/form-submissions/capture').send(body);
const tag = (n) => `${n} ${RUN}`;

const nationalValues = () => ({
  firstName: tag('Jane'), lastName: 'Doe', email: 'jane@example.com', message: tag('Hello'),
});

const findMine = async (needle) => {
  const all = await strapi.documents('api::form-submission.form-submission')
    .findMany({ populate: { chapter: { fields: ['slug'] }, page: { fields: ['slug'] } }, limit: -1 });
  return all.find((r) => JSON.stringify(r.data ?? {}).includes(needle));
};

describe('POST /api/form-submissions/capture', () => {
  it('accepts a national submission with NO authentication', async () => {
    // The entire point: the public can reach this. Every other write endpoint
    // in this system 401s without a JWT.
    const res = await post({ renderedAt: human(), values: nationalValues() });
    expect(res.status).toBe(200);
    expect(res.body.data.received).toBe(true);
  });

  it('actually writes a row — the bug this plan exists to fix', async () => {
    const message = tag('Persisted');
    await post({ renderedAt: human(), values: { ...nationalValues(), message } });
    const row = await findMine(message);
    expect(row).toBeTruthy();
    expect(row.data.message).toBe(message);
    expect(row.handled).toBe(false);
    expect(row.submittedAt).toBeTruthy();
  });

  it('derives the chapter from the page, so the chapter admin screen can see it', async () => {
    const message = tag('ChapterScoped');
    const res = await post({
      renderedAt: human(), pageDocumentId: chapterPage.documentId,
      values: { firstName: tag('Ivy'), email: 'ivy@example.com', message },
    });
    expect(res.status).toBe(200);
    const row = await findMine(message);
    expect(row.chapter?.slug).toBe(chapterSlug);
    expect(row.page).toBeTruthy();
  });

  it('IGNORES a client-supplied chapter and handled flag', async () => {
    // The reason this is not the core `create`. A spammer marking their own
    // submission handled would hide it from the screen meant to surface it.
    const message = tag('Smuggle');
    await post({
      renderedAt: human(),
      values: { ...nationalValues(), message, handled: true, chapter: 'boston' },
    });
    const row = await findMine(message);
    expect(row.handled).toBe(false);
    expect(row.chapter).toBeFalsy();
    expect(row.data).not.toHaveProperty('handled');
  });

  it('400s a missing required field', async () => {
    const res = await post({
      renderedAt: human(), values: { firstName: 'Jane', email: 'j@example.com' },
    });
    expect(res.status).toBe(400);
    expect(res.body.error?.message ?? '').toMatch(/required/i);
  });

  it('400s an email that is not an email', async () => {
    const res = await post({
      renderedAt: human(), values: { ...nationalValues(), email: 'nope' },
    });
    expect(res.status).toBe(400);
  });

  it('404s a page documentId that does not exist', async () => {
    const res = await post({
      renderedAt: human(), pageDocumentId: 'nosuchpage000000000000',
      values: nationalValues(),
    });
    expect(res.status).toBe(404);
  });

  it('404s a real page that carries no contact form', async () => {
    // Stops a caller attributing an enquiry to any chapter they like by naming
    // one of that chapter's other pages.
    const pages = await strapi.documents('api::page.page').findMany({
      filters: { slug: { $ne: 'home' } }, populate: { components: true },
      status: 'published', limit: -1,
    });
    const noForm = pages.find((p) =>
      !(p.components ?? []).some((c) => c.__component === 'shared.contact-form'));
    expect(noForm).toBeTruthy();
    const res = await post({
      renderedAt: human(), pageDocumentId: noForm.documentId, values: nationalValues(),
    });
    expect(res.status).toBe(404);
  });

  it('swallows a honeypot hit with a 200 and writes nothing', async () => {
    const message = tag('Honeypot');
    const res = await post({
      renderedAt: human(), website: 'http://spam.example',
      values: { ...nationalValues(), message },
    });
    expect(res.status).toBe(200);          // a bot learns nothing
    expect(await findMine(message)).toBeFalsy();
  });

  it('swallows an instant submission with a 200 and writes nothing', async () => {
    const message = tag('TooFast');
    const res = await post({
      renderedAt: String(Date.now()), values: { ...nationalValues(), message },
    });
    expect(res.status).toBe(200);
    expect(await findMine(message)).toBeFalsy();
  });

  it('still accepts a submission whose timestamp is missing entirely', async () => {
    // A stale cached page must not cost someone their enquiry.
    const message = tag('NoTimestamp');
    const res = await post({ values: { ...nationalValues(), message } });
    expect(res.status).toBe(200);
    expect(await findMine(message)).toBeTruthy();
  });

  it('429s once the per-IP window is full', async () => {
    // RATE_LIMIT is 5; this suite has already spent some of the window, so
    // drive it deliberately rather than assuming a starting count.
    let sawLimit = false;
    for (let i = 0; i < 12; i += 1) {
      const res = await post({
        renderedAt: human(), values: { ...nationalValues(), message: tag(`Flood${i}`) },
      });
      if (res.status === 429) { sawLimit = true; break; }
    }
    expect(sawLimit).toBe(true);
  });

  it('never exposes captured submissions to the public', async () => {
    // The grant is `capture` alone. `find` would publish every enquiry the
    // association has ever received.
    expect((await api().get('/api/form-submissions')).status).toBe(403);
  });
});
```

- [ ] **Step 2: Run them, then the whole suite**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && pkill -f "strapi develop" ; \
  PATH="/opt/homebrew/bin:$PATH" npx vitest run tests/integration/capture.test.js
cd /Users/nk/Projects/AREAA/areaa-cms && PATH="/opt/homebrew/bin:$PATH" npm test
```

Expected: **13 tests**, then **217 across 18 files** — 175 from plans 1–4, plus 13 capture unit, 16 spam unit, 13 capture integration.

- [ ] **Step 3: Prove no residue**

The rate-limit test writes several rows; the cleanup matches on `RUN`, so verify it actually caught them:

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && \
  sqlite3 .tmp/data.db "SELECT COUNT(*) FROM form_submissions;" && \
  PATH="/opt/homebrew/bin:$PATH" npx vitest run tests/integration/capture.test.js > /dev/null && \
  sqlite3 .tmp/data.db "SELECT COUNT(*) FROM form_submissions;"
```

Expected: **the two numbers are identical.** Not necessarily 0 — by this point the browser walkthrough may have left real rows — but unchanged across a run.

- [ ] **Step 4: Commit**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && \
  git add tests/integration/capture.test.js && \
  git commit -m "test: public capture, chapter derivation and the smuggling defences"
```

---

## Chunk 3: The national form tells the truth

### Task 5: Payload mapping and the API route

**Files:** Create `src/lib/contact-form.ts`, `tests/unit/contact-form.test.ts`, `src/pages/api/contact.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { toCapturePayload, HONEYPOT_FIELD } from "../../src/lib/contact-form";

const form = (entries: Record<string, string>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(entries)) fd.set(k, v);
    return fd;
};

describe("toCapturePayload", () => {
    it("collects the declared field names into values", () => {
        const fd = form({ firstName: "Jane", email: "j@x.com", message: "Hi" });
        expect(toCapturePayload(fd, ["firstName", "email", "message"]).values)
            .toEqual({ firstName: "Jane", email: "j@x.com", message: "Hi" });
    });

    it("carries the honeypot and timestamp OUTSIDE values", () => {
        // They are envelope, not content — putting them in `values` would store
        // them on the submission and show them to the chapter admin.
        const fd = form({ firstName: "J", [HONEYPOT_FIELD]: "", renderedAt: "123" });
        const out = toCapturePayload(fd, ["firstName"]);
        expect(out.renderedAt).toBe("123");
        expect(out.values).not.toHaveProperty(HONEYPOT_FIELD);
        expect(out.values).not.toHaveProperty("renderedAt");
    });

    it("passes the honeypot through so the server can see it tripped", () => {
        const fd = form({ firstName: "J", [HONEYPOT_FIELD]: "spam" });
        expect(toCapturePayload(fd, ["firstName"])[HONEYPOT_FIELD]).toBe("spam");
    });

    it("includes pageDocumentId when the form carries one", () => {
        const fd = form({ firstName: "J", pageDocumentId: "pg1" });
        expect(toCapturePayload(fd, ["firstName"]).pageDocumentId).toBe("pg1");
    });

    it("omits pageDocumentId entirely for the national form", () => {
        // Absent, not "" — the server branches on falsiness to pick the
        // national field set, and "" would take the same branch by accident
        // rather than by intent.
        expect(toCapturePayload(form({ firstName: "J" }), ["firstName"]))
            .not.toHaveProperty("pageDocumentId");
    });

    it("ignores posted keys the form did not declare", () => {
        const fd = form({ firstName: "J", handled: "true" });
        expect(toCapturePayload(fd, ["firstName"]).values).not.toHaveProperty("handled");
    });

    it("keeps a declared field that was left blank, so the server can require it", () => {
        // Dropping it here would turn "you left this empty" into "this field
        // does not exist", and the visitor would get a confusing error.
        const fd = form({ firstName: "", email: "j@x.com" });
        expect(toCapturePayload(fd, ["firstName", "email"]).values.firstName).toBe("");
    });
});
```

- [ ] **Step 2: Implement the mapper**

```ts
/** Must match spam.js. Named to look worth filling in. */
export const HONEYPOT_FIELD = "website";

export interface CapturePayload {
    values: Record<string, string>;
    renderedAt?: string;
    pageDocumentId?: string;
    [HONEYPOT_FIELD]?: string;
}

/**
 * FormData -> the capture endpoint's payload.
 *
 * `names` is the field list the form actually rendered, so a key nobody
 * declared cannot reach `values`. The server whitelists again from its own
 * config — this is convenience, not the security boundary.
 *
 * The honeypot and timestamp travel OUTSIDE `values`: they are envelope, and
 * anything inside `values` is stored and shown to a chapter admin.
 */
export function toCapturePayload(fd: FormData, names: string[]): CapturePayload {
    const values: Record<string, string> = {};
    for (const name of names) {
        const v = fd.get(name);
        if (v !== null) values[name] = String(v);
    }

    const payload: CapturePayload = { values };

    const renderedAt = fd.get("renderedAt");
    if (renderedAt !== null) payload.renderedAt = String(renderedAt);

    const honeypot = fd.get(HONEYPOT_FIELD);
    if (honeypot !== null) payload[HONEYPOT_FIELD] = String(honeypot);

    const page = fd.get("pageDocumentId");
    if (page !== null && String(page) !== "") payload.pageDocumentId = String(page);

    return payload;
}
```

- [ ] **Step 3: Run it**

```bash
cd /Users/nk/Projects/AREAA/areaa-frontend && npx vitest run tests/unit/contact-form.test.ts
```

Expected: PASS, **7 tests**.

- [ ] **Step 4: The API route**

Every other form route in this app goes through `beginChapterAdminPost`, which requires a session. **This one must not** — the caller is the public. It is a separate helper on purpose:

```ts
import type { APIRoute } from "astro";
import { toCapturePayload } from "../../lib/contact-form";

export const prerender = false;

const env = import.meta.env as Record<string, string | undefined>;
const STRAPI_URL = process.env.STRAPI_URL || env.STRAPI_URL || "http://localhost:1337";

/**
 * Public contact capture. No session, by design.
 *
 * Astro's `checkOrigin` still applies, so this is not an open relay for any
 * origin. The declared field names travel with the form so the payload mapper
 * knows what to collect; the server re-derives them from its own config.
 */
export const POST: APIRoute = async ({ request, redirect, clientAddress }) => {
    const form = await request.formData();
    const back = String(form.get("returnTo") ?? "/contact");
    const names = String(form.get("fieldNames") ?? "").split(",").filter(Boolean);

    // Without this the payload is empty and every submission 400s with
    // "required", which reads as a validation bug rather than a wiring bug.
    if (names.length === 0) return redirect(`${back}?contact=error`, 303);

    const payload = toCapturePayload(form, names);

    let status = 0;
    let body: any = null;
    try {
        const res = await fetch(`${STRAPI_URL}/api/form-submissions/capture`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                // Preserve the real caller so the rate limiter buckets per
                // visitor rather than per Astro process.
                "X-Forwarded-For": clientAddress ?? "",
            },
            body: JSON.stringify(payload),
        });
        status = res.status;
        body = await res.json().catch(() => null);
    } catch {
        return redirect(`${back}?contact=error`, 303);
    }

    if (status === 200 && body?.data?.received) return redirect(`${back}?contact=sent`, 303);
    if (status === 429) return redirect(`${back}?contact=throttled`, 303);
    if (status === 400) {
        const message = encodeURIComponent(body?.error?.message ?? "");
        return redirect(`${back}?contact=invalid&why=${message}`, 303);
    }
    return redirect(`${back}?contact=error`, 303);
};
```

For `X-Forwarded-For` to be honoured, Strapi must be configured to trust the proxy. Verify during Task 12; if `ctx.request.ip` still reports the Astro host, the rate limit degrades to one shared bucket — which is safe but blunt, and should be recorded as a limitation rather than left as a surprise.

- [ ] **Step 5: Commit**

```bash
cd /Users/nk/Projects/AREAA/areaa-frontend && \
  git add src/lib/contact-form.ts tests/unit/contact-form.test.ts src/pages/api/contact.ts && \
  git commit -m "feat: public contact capture route and payload mapping"
```

---

### Task 6: `ContactForm.astro` stops lying

**Files:** Modify `src/components/ContactForm.astro`, `src/pages/contact.astro`, `src/pages/account/chapter-support.astro`; create `tests/unit/contact-form-render.test.ts`

- [ ] **Step 1: Write the failing render test**

```ts
import { describe, it, expect } from "vitest";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import ContactForm from "../../src/components/ContactForm.astro";
import { HONEYPOT_FIELD } from "../../src/lib/contact-form";

const render = async (props: Record<string, unknown> = {}) => {
    const container = await AstroContainer.create();
    return container.renderToString(ContactForm, { props });
};

describe("ContactForm", () => {
    it("posts to the capture route instead of being presentational", async () => {
        const html = await render();
        expect(html).toContain('method="post"');
        expect(html).toContain('action="/api/contact"');
    });

    it("carries the honeypot, hidden from sight and from assistive tech", async () => {
        const html = await render();
        expect(html).toContain(`name="${HONEYPOT_FIELD}"`);
        expect(html).toMatch(/tabindex="-1"/);
        expect(html).toMatch(/aria-hidden="true"/);
        // autocomplete=off matters: a browser autofilling the trap would make a
        // real visitor look like a bot.
        expect(html).toMatch(/autocomplete="off"/);
    });

    it("carries a render timestamp and the declared field names", async () => {
        const html = await render();
        expect(html).toContain('name="renderedAt"');
        expect(html).toContain('name="fieldNames"');
        expect(html).toContain("firstName,lastName,email,message");
    });

    it("shows the success state ONLY when the server said so", async () => {
        // The bug this plan exists to fix: the old version showed it
        // unconditionally, client-side, having sent nothing.
        expect(await render()).not.toContain("on its way");
        expect(await render({ result: "sent" })).toContain("on its way");
    });

    it("shows a real error rather than a success state when the send failed", async () => {
        const html = await render({ result: "error" });
        expect(html).not.toContain("on its way");
        expect(html).toMatch(/could not be sent|try again/i);
    });

    it("explains a throttle differently from a failure", async () => {
        const html = await render({ result: "throttled" });
        expect(html).toMatch(/too many|shortly/i);
    });

    it("keeps the form on screen when the submission was invalid", async () => {
        // Hiding it would strand the visitor with an error and no way to fix it.
        const html = await render({ result: "invalid" });
        expect(html).toContain('action="/api/contact"');
    });

    it("passes pageDocumentId through when given one", async () => {
        expect(await render({ pageDocumentId: "pg1" })).toContain('value="pg1"');
    });
});
```

- [ ] **Step 2: Rewrite the component**

The whole `<script>` block goes. It is the bug.

```astro
---
import FormField from "./FormField.astro";
import { HONEYPOT_FIELD } from "../lib/contact-form";

interface Props {
    intro?: string;
    /** Set when this form sits on a CMS page, so the server can derive a chapter. */
    pageDocumentId?: string;
    /** Where /api/contact redirects back to. */
    returnTo?: string;
    /** The `contact` search param from the last submit. */
    result?: string | null;
    /** Server-supplied validation message, when result is "invalid". */
    why?: string | null;
}

const {
    intro = "Fill out the form below and someone will be in contact with you shortly.",
    pageDocumentId, returnTo = "/contact", result = null, why = null,
} = Astro.props;

const FIELD_NAMES = ["firstName", "lastName", "email", "message"];

// Rendered server-side per request, so the value is genuinely the render time.
const renderedAt = String(Date.now());

const sent = result === "sent";
const messages: Record<string, string> = {
    error: "Your message could not be sent. Please try again, or email us directly.",
    throttled: "That's a few messages in a short time. Please try again shortly.",
    invalid: why || "Please check the form and try again.",
};
const errorMessage = !sent && result ? (messages[result] ?? messages.error) : null;
---

<div class="contact-form">
    {sent ? (
        <div class="contact-form__success" role="status">
            <p class="contact-form__success-title">Thank you — your message is on its way.</p>
            <p class="contact-form__success-body">
                Someone from the AREAA team will be in contact with you shortly.
            </p>
        </div>
    ) : (
        <>
            <p class="contact-form__intro">{intro}</p>
            {errorMessage && <p class="contact-form__error" role="alert">{errorMessage}</p>}

            <form class="contact-form__form" method="post" action="/api/contact">
                <input type="hidden" name="returnTo" value={returnTo} />
                <input type="hidden" name="fieldNames" value={FIELD_NAMES.join(",")} />
                <input type="hidden" name="renderedAt" value={renderedAt} />
                {pageDocumentId && <input type="hidden" name="pageDocumentId" value={pageDocumentId} />}

                {/*
                  Honeypot. Hidden with CSS rather than `type=hidden` so a bot
                  parsing the DOM sees a fillable text input. aria-hidden and
                  tabindex=-1 keep it away from keyboard and screen-reader users;
                  autocomplete=off stops a browser filling it for a real person.
                */}
                <div class="contact-form__trap" aria-hidden="true">
                    <label for="website-field">Website</label>
                    <input type="text" id="website-field" name={HONEYPOT_FIELD}
                        tabindex="-1" autocomplete="off" />
                </div>

                <div class="contact-form__row">
                    <FormField label="First Name" name="firstName" placeholder="Jane" required autocomplete="given-name" />
                    <FormField label="Last Name" name="lastName" placeholder="Doe" required autocomplete="family-name" />
                </div>
                <FormField label="Email" name="email" type="email" placeholder="jane@example.com" required autocomplete="email" />
                <FormField label="Message" name="message" type="textarea" placeholder="How can we help?" required />

                <button type="submit" class="btn btn--primary">Submit Message</button>
            </form>
        </>
    )}
</div>
```

Add to the existing `<style>`, keeping everything already there:

```css
    .contact-form__error {
        margin: 0 0 var(--space-600);
        padding: var(--space-300) var(--space-400);
        border: var(--stroke-border) solid var(--primitive-brand-300);
        border-radius: var(--radius-100);
        background-color: var(--primitive-brand-50);
        color: var(--primitive-brand-700);
        font-family: var(--font-family-body);
    }
    /* Off-screen rather than display:none — some bots skip undisplayed inputs. */
    .contact-form__trap {
        position: absolute; left: -9999px; width: 1px; height: 1px; overflow: hidden;
    }
```

Note the `novalidate` attribute is **gone**. It existed to let the old client-side handler run `reportValidity()` itself; with a real POST, native browser validation is a free first pass and the server validates regardless.

- [ ] **Step 3: Both call sites pass the result through**

```diff
 // contact.astro
-<ContactForm />
+<ContactForm
+    returnTo="/contact"
+    result={Astro.url.searchParams.get("contact")}
+    why={Astro.url.searchParams.get("why")}
+/>
```

```diff
 // account/chapter-support.astro
-<ContactForm intro="Fill out the form below and someone will be in contact with you shortly." />
+<ContactForm
+    intro="Fill out the form below and someone will be in contact with you shortly."
+    returnTo="/account/chapter-support"
+    result={Astro.url.searchParams.get("contact")}
+    why={Astro.url.searchParams.get("why")}
+/>
```

- [ ] **Step 4: Verify**

Separate gates:

```bash
cd /Users/nk/Projects/AREAA/areaa-frontend && npm run check
cd /Users/nk/Projects/AREAA/areaa-frontend && npm test
```

Expected: 0 errors, then **90 passed** (75 + 7 payload + 8 render).

- [ ] **Step 5: Delete the bug report**

`docs/2026-08-04-contact-form-sends-nothing.md` describes a bug that no longer exists. Leaving it is how a fixed issue gets re-reported. Move its two remaining true observations — no email delivery, and no national inbox — into this plan's Known limitations, then remove the file.

```bash
git rm docs/2026-08-04-contact-form-sends-nothing.md
```

- [ ] **Step 6: Commit**

```bash
cd /Users/nk/Projects/AREAA/areaa-frontend && \
  git add src/components/ContactForm.astro tests/unit/contact-form-render.test.ts \
          src/pages/contact.astro src/pages/account/chapter-support.astro && \
  git commit -m "fix: contact form actually submits, and reports failure honestly"
```

---

## Chunk 4: The microsite form renders

Six configured component slots currently render nothing. This is the only surface that can feed the chapter admin submissions screen.

### Task 7: Type, adapter and component

**Files:** Modify `src/types/strapi.ts`, `src/lib/adapters.ts`; create `src/components/ContactSection.astro`, `tests/unit/contact-adapter.test.ts`

- [ ] **Step 1: Replace the stub type**

`strapi.ts:176` is `{ __component, id }` and nothing else. Give it the real shape:

```ts
export interface FormFieldComponent {
  id: number;
  label: string;
  name: string;
  type: "text" | "email" | "tel" | "textarea" | "select" | "checkbox";
  required?: boolean | null;
  placeholder?: string | null;
  /** Newline-separated, for `select`. */
  options?: string | null;
}

export interface ContactFormComponent {
  __component: "shared.contact-form";
  id: number;
  title?: string | null;
  intro?: string | null;
  fields?: FormFieldComponent[] | null;
  submitLabel?: string | null;
  /** Not used yet — no email provider is configured. See Known limitations. */
  notificationEmails?: string | null;
}
```

- [ ] **Step 2: Write the failing adapter test**

```ts
import { describe, it, expect } from "vitest";
import { toContactProps } from "../../src/lib/adapters";

const base = { __component: "shared.contact-form" as const, id: 1 };

describe("toContactProps", () => {
    it("keeps the renderable fields in order", () => {
        const out = toContactProps({ ...base, fields: [
            { id: 1, label: "Name", name: "name", type: "text" },
            { id: 2, label: "Email", name: "email", type: "email", required: true },
        ]});
        expect(out.fields.map((f) => f.name)).toEqual(["name", "email"]);
        expect(out.fields[1].required).toBe(true);
    });

    it("DROPS checkbox fields, which FormField cannot render", () => {
        // Rendering a broken control is worse than omitting it; the server
        // drops the same type, so the two stay in step.
        const out = toContactProps({ ...base, fields: [
            { id: 1, label: "Name", name: "name", type: "text" },
            { id: 2, label: "Opt in", name: "optIn", type: "checkbox" },
        ]});
        expect(out.fields.map((f) => f.name)).toEqual(["name"]);
    });

    it("drops a field with no name, which could never be submitted", () => {
        const out = toContactProps({ ...base, fields: [
            { id: 1, label: "Broken", name: "", type: "text" },
        ]});
        expect(out.fields).toEqual([]);
    });

    it("splits select options on newlines and trims them", () => {
        const out = toContactProps({ ...base, fields: [
            { id: 1, label: "Topic", name: "topic", type: "select", options: "Sales\n  Support  \n\nOther" },
        ]});
        expect(out.fields[0].options).toEqual(["Sales", "Support", "Other"]);
    });

    it("falls back to a usable submit label", () => {
        expect(toContactProps({ ...base }).submitLabel).toBe("Send");
        expect(toContactProps({ ...base, submitLabel: "" }).submitLabel).toBe("Send");
        expect(toContactProps({ ...base, submitLabel: "Get in touch" }).submitLabel).toBe("Get in touch");
    });

    it("never exposes notificationEmails to the browser", () => {
        // It is an internal routing address; rendering it would publish staff
        // email to every visitor and every scraper.
        const out = toContactProps({ ...base, notificationEmails: "staff@areaa.org" }) as any;
        expect(JSON.stringify(out)).not.toContain("staff@areaa.org");
    });

    it("survives a component with no fields configured at all", () => {
        expect(toContactProps({ ...base, fields: null }).fields).toEqual([]);
    });
});
```

- [ ] **Step 3: Implement the adapter**

```ts
const RENDERABLE = new Set(["text", "email", "tel", "textarea", "select"]);

export interface ContactProps {
    title: string | null;
    intro: string | null;
    submitLabel: string;
    fields: {
        label: string; name: string;
        type: "text" | "email" | "tel" | "textarea" | "select";
        required: boolean; placeholder?: string; options?: string[];
    }[];
}

/**
 * `shared.contact-form` -> what ContactSection renders.
 *
 * `checkbox` is dropped: it is in the CMS enum but FormField.astro has no case
 * for it, and capture.js drops it server-side too, so the two agree. Adding it
 * means adding the control in both places, not just here.
 *
 * `notificationEmails` is deliberately NOT carried through — it is an internal
 * routing address and this object is serialised into the page.
 */
export function toContactProps(c: ContactFormComponent): ContactProps {
    const fields = (c.fields ?? [])
        .filter((f) => RENDERABLE.has(f.type) && (f.name ?? "").trim() !== "")
        .map((f) => ({
            label: f.label,
            name: f.name.trim(),
            type: f.type as ContactProps["fields"][number]["type"],
            required: Boolean(f.required),
            ...(f.placeholder ? { placeholder: f.placeholder } : {}),
            ...(f.type === "select"
                ? { options: (f.options ?? "").split("\n").map((o) => o.trim()).filter(Boolean) }
                : {}),
        }));

    return {
        title: c.title ?? null,
        intro: c.intro ?? null,
        submitLabel: c.submitLabel?.trim() || "Send",
        fields,
    };
}
```

- [ ] **Step 4: The component**

`ContactSection.astro` renders the configured fields, with the same honeypot, timestamp and hidden inputs as `ContactForm.astro`. Where that one hardcodes four fields, this maps `fields`. It posts to the same `/api/contact`, and passes `pageDocumentId` so the server derives the chapter.

```astro
---
import FormField from "./FormField.astro";
import { HONEYPOT_FIELD } from "../lib/contact-form";
import type { ContactProps } from "../lib/adapters";

interface Props extends ContactProps {
    pageDocumentId?: string;
    returnTo: string;
    result?: string | null;
    why?: string | null;
}

const {
    title, intro, submitLabel, fields,
    pageDocumentId, returnTo, result = null, why = null,
} = Astro.props;

const renderedAt = String(Date.now());
const sent = result === "sent";
const messages: Record<string, string> = {
    error: "Your message could not be sent. Please try again.",
    throttled: "That's a few messages in a short time. Please try again shortly.",
    invalid: why || "Please check the form and try again.",
};
const errorMessage = !sent && result ? (messages[result] ?? messages.error) : null;
---

<section class="csec">
    {title && <h2 class="csec__title">{title}</h2>}

    {sent ? (
        <p class="csec__success" role="status">
            Thank you — your message is on its way.
        </p>
    ) : (
        <>
            {intro && <p class="csec__intro">{intro}</p>}
            {errorMessage && <p class="csec__error" role="alert">{errorMessage}</p>}

            {fields.length === 0 ? (
                /* A form with no usable fields must not render a Save button
                   that can only ever 400. */
                <p class="csec__intro">This form isn't ready yet. Please check back shortly.</p>
            ) : (
                <form class="csec__form" method="post" action="/api/contact">
                    <input type="hidden" name="returnTo" value={returnTo} />
                    <input type="hidden" name="fieldNames" value={fields.map((f) => f.name).join(",")} />
                    <input type="hidden" name="renderedAt" value={renderedAt} />
                    {pageDocumentId && <input type="hidden" name="pageDocumentId" value={pageDocumentId} />}

                    <div class="csec__trap" aria-hidden="true">
                        <label for="csec-website">Website</label>
                        <input type="text" id="csec-website" name={HONEYPOT_FIELD}
                            tabindex="-1" autocomplete="off" />
                    </div>

                    {fields.map((f) => (
                        <FormField
                            label={f.label} name={f.name} type={f.type}
                            required={f.required} placeholder={f.placeholder} options={f.options}
                        />
                    ))}

                    <button type="submit" class="btn btn--primary">{submitLabel}</button>
                </form>
            )}
        </>
    )}
</section>

<style>
    .csec { max-width: 720px; margin: 0 auto; padding: var(--space-800) var(--space-1600); }
    .csec__title { margin: 0 0 var(--space-400); font-family: var(--font-family-header);
        font-weight: 700; font-size: 32px; line-height: 1.1; }
    .csec__intro { margin: 0 0 var(--space-600); font-family: var(--font-family-body);
        font-size: 16px; line-height: 1.4; color: var(--primitive-neutral-800); }
    .csec__form { display: flex; flex-direction: column; gap: var(--space-400); }
    .csec__success, .csec__error {
        margin: 0 0 var(--space-600); padding: var(--space-300) var(--space-400);
        border: var(--stroke-border) solid var(--primitive-brand-300);
        border-radius: var(--radius-100); background-color: var(--primitive-brand-50);
        color: var(--primitive-brand-700); font-family: var(--font-family-body);
    }
    .csec__trap { position: absolute; left: -9999px; width: 1px; height: 1px; overflow: hidden; }
    @media (max-width: 768px) { .csec { padding: var(--space-800) var(--space-600); } }
</style>
```

- [ ] **Step 5: Verify and commit**

```bash
cd /Users/nk/Projects/AREAA/areaa-frontend && npx vitest run tests/unit/contact-adapter.test.ts
cd /Users/nk/Projects/AREAA/areaa-frontend && npm run check
```

Expected: **7 tests**, 0 errors.

```bash
cd /Users/nk/Projects/AREAA/areaa-frontend && \
  git add src/types/strapi.ts src/lib/adapters.ts src/components/ContactSection.astro \
          tests/unit/contact-adapter.test.ts && \
  git commit -m "feat: contact-form component type, adapter and section renderer"
```

---

### Task 8: `PageBody` dispatches it

The dispatcher needs the page's `documentId` and the current URL, neither of which it receives today. That is the real work here.

**Files:** Modify `src/components/PageBody.astro`, `src/pages/chapters/[chapter]/index.astro`, and every other page rendering `PageBody`; create `tests/unit/page-body-contact.test.ts`

- [ ] **Step 1: Find every caller before changing the props**

```bash
cd /Users/nk/Projects/AREAA/areaa-frontend && grep -rn "<PageBody" src/
```

Every one gets the new optional props. They are optional so a caller that forgets still compiles — but then the microsite form loses its chapter, which is exactly the silent failure this plan is trying to end. **Verify the list is complete before moving on**, and add the props to all of them in this step.

- [ ] **Step 2: Write the failing render test**

```ts
import { describe, it, expect } from "vitest";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import PageBody from "../../src/components/PageBody.astro";

const CONTACT = {
    __component: "shared.contact-form" as const,
    id: 9,
    title: "Get in touch",
    submitLabel: "Send it",
    fields: [
        { id: 1, label: "Your name", name: "name", type: "text" as const, required: true },
        { id: 2, label: "Email", name: "email", type: "email" as const, required: true },
    ],
};

const render = async (props: Record<string, unknown>) => {
    const container = await AstroContainer.create();
    return container.renderToString(PageBody, { props });
};

describe("PageBody contact-form dispatch", () => {
    it("renders the component that used to disappear", async () => {
        // Six of these are configured on chapter home pages and rendered
        // nothing at all, because the switch had no case for them.
        const html = await render({ components: [CONTACT], returnTo: "/chapters/boston" });
        expect(html).toContain("Get in touch");
        expect(html).toContain('name="name"');
        expect(html).toContain("Send it");
    });

    it("passes pageDocumentId through, so the server can derive the chapter", async () => {
        const html = await render({
            components: [CONTACT], returnTo: "/chapters/boston", pageDocumentId: "pg-boston",
        });
        expect(html).toContain('name="pageDocumentId"');
        expect(html).toContain('value="pg-boston"');
    });

    it("still renders nothing for a component it does not know", async () => {
        const html = await render({
            components: [{ __component: "shared.video-embed", id: 3 } as any],
            returnTo: "/x",
        });
        expect(html.trim()).toBe("");
    });
});
```

- [ ] **Step 3: Implement**

```diff
 interface Props {
   components: PageComponent[];
   memberSubtitle?: "chapter" | "title";
+  /** Threaded to the contact form so the server can derive the chapter. */
+  pageDocumentId?: string;
+  /** Where a contact submission redirects back to. */
+  returnTo?: string;
+  /** The `contact` / `why` search params from the last submit. */
+  contactResult?: string | null;
+  contactWhy?: string | null;
 }
```

```diff
       case "shared.faq":
         return <Faq {...toFaqProps(component)} />;
+      case "shared.contact-form":
+        return (
+          <ContactSection
+            {...toContactProps(component)}
+            pageDocumentId={pageDocumentId}
+            returnTo={returnTo ?? "/"}
+            result={contactResult}
+            why={contactWhy}
+          />
+        );
       default:
         return null;
```

And in the microsite page:

```diff
 <MainLayout title={`${chapter.name} | AREAA`} description={page.description ?? ""}>
-    <PageBody components={page.components ?? []} memberSubtitle="title" />
+    <PageBody
+        components={page.components ?? []}
+        memberSubtitle="title"
+        pageDocumentId={page.documentId}
+        returnTo={`/chapters/${chapter.slug}`}
+        contactResult={Astro.url.searchParams.get("contact")}
+        contactWhy={Astro.url.searchParams.get("why")}
+    />
 </MainLayout>
```

Confirm `Page` in `strapi.ts` carries `documentId`; if it does not, add it — `content.ts` already receives it from Strapi.

- [ ] **Step 4: Verify and commit**

```bash
cd /Users/nk/Projects/AREAA/areaa-frontend && npm run check
cd /Users/nk/Projects/AREAA/areaa-frontend && npm test
```

Expected: 0 errors, then **100 passed** (90 + 7 adapter + 3 dispatch).

```bash
cd /Users/nk/Projects/AREAA/areaa-frontend && \
  git add src/components/PageBody.astro src/pages/ tests/unit/page-body-contact.test.ts && \
  git commit -m "feat: microsites render their configured contact form"
```

---

## Chunk 5: Retire `chapter.partners`

**Independently shippable.** Touches no file the other chunks touch. If time is short, do this one.

### Task 9: Drop the relation, both sides

**Files:** Modify `src/api/chapter/content-types/chapter/schema.json`, `src/api/partner/content-types/partner/schema.json`, `scripts/seed.js`

- [ ] **Step 1: Snapshot first — `.tmp/data.db` is untracked and git cannot see this**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && \
  sqlite3 .tmp/data.db "SELECT c.slug, c.published_at IS NULL AS draft, p.name FROM chapters_partners_lnk l JOIN chapters c ON c.id=l.chapter_id JOIN partners p ON p.id=l.partner_id ORDER BY c.slug, c.published_at, p.name;" > /tmp/p7-chapter-partners.txt && \
  cat /tmp/p7-chapter-partners.txt && wc -l < /tmp/p7-chapter-partners.txt
```

Expected: **12 rows**.

- [ ] **Step 2: Prove the two stores still agree, immediately before dropping**

This is the assumption the whole task rests on, and it stops being true the moment someone saves through `/partners`. **Re-verify now rather than trusting the table at the top of this plan.**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && \
  sqlite3 .tmp/data.db "
SELECT c.slug,
       (SELECT group_concat(p.name) FROM chapters_partners_lnk cl JOIN partners p ON p.id=cl.partner_id WHERE cl.chapter_id=c.id) AS chapter_field,
       (SELECT group_concat(p2.name) FROM pages_cmps z
          JOIN pages pg ON pg.id=z.entity_id
          JOIN pages_chapter_lnk pl ON pl.page_id=pg.id
          JOIN components_shared_partner_groups_partners_lnk gl ON gl.partner_group_id=z.cmp_id
          JOIN partners p2 ON p2.id=gl.partner_id
        WHERE z.component_type='shared.partner-group' AND pg.slug='home'
          AND pl.chapter_id=c.id AND pg.published_at IS NULL) AS component
FROM chapters c WHERE c.published_at IS NULL ORDER BY c.slug;"
```

Expected: the two columns match for every chapter.

**If they do not match, STOP.** A real divergence means someone has saved through `/partners`, the component is authoritative, and dropping is still correct — but the deleted rows are then genuinely different data and the person running this plan should see that and decide, not discover it afterwards.

- [ ] **Step 3: Remove from both schemas**

From `chapter/schema.json`:

```diff
-    "partners": {
-      "type": "relation",
-      "relation": "manyToMany",
-      "target": "api::partner.partner",
-      "inversedBy": "chapters"
-    },
```

From `partner/schema.json` — the inverse must go too, or Strapi has a relation pointing at an attribute that no longer exists:

```diff
-    "chapters": {
-      "type": "relation",
-      "relation": "manyToMany",
-      "target": "api::chapter.chapter",
-      "mappedBy": "partners"
-    }
```

Copy the exact JSON out of the files rather than trusting this diff — key order and the `inversedBy`/`mappedBy` direction must match what is actually there.

- [ ] **Step 4: Stop the seed writing it**

`scripts/seed.js:261`:

```diff
         administrators: chapterMembers.map((m) => m.id),
         members: chapterMembers.map((m) => m.id),
-        partners: a.partners.map((i) => partners[i].documentId),
       },
```

Check whether `a.partners` is now unused in the chapter fixture. If the partner-group component is seeded from the same array, **leave the array alone** — only the write to `chapter.partners` goes.

- [ ] **Step 5: Boot and confirm the table is gone**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && pkill -f "strapi develop" ; \
  PATH="/opt/homebrew/bin:$PATH" node scripts/boot-once.js
cd /Users/nk/Projects/AREAA/areaa-cms && \
  sqlite3 .tmp/data.db "SELECT name FROM sqlite_master WHERE type='table' AND name='chapters_partners_lnk';"
```

Expected: `BOOTSTRAP OK`, then **no output** — Strapi drops the join table when the relation goes.

If the table survives, Strapi has left it orphaned. Drop it explicitly and say so in the commit:

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && \
  sqlite3 .tmp/data.db "DROP TABLE IF EXISTS chapters_partners_lnk;"
```

- [ ] **Step 6: Prove the microsite is untouched**

The whole claim is that nothing read this field. Verify against rendered output, not just the schema:

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && \
  sqlite3 .tmp/data.db "SELECT COUNT(*) FROM components_shared_partner_groups_partners_lnk;"
```

Expected: **22**, unchanged. Then with both servers running, confirm `/chapters/aloha-hawaii` still renders two partner logos.

- [ ] **Step 7: Commit**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && \
  git add src/api/chapter/ src/api/partner/ scripts/seed.js && \
  git commit -m "refactor: drop chapter.partners, which nothing read

The microsite renders shared.partner-group; chapter.partners was only
ever written by the seed. Verified identical to the component on every
chapter immediately before removal, so nothing is lost — and after plan
4 a chapter admin's save updated one store and not the other, leaving
two that looked equally authoritative."
```

---

### Task 10: Prove nothing regressed

- [ ] **Step 1: Full suite plus the partner integration tests**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && pkill -f "strapi develop" ; \
  PATH="/opt/homebrew/bin:$PATH" npm test
```

Expected: **217**. Plan 4's `partners.test.js` exercises the component path only, so it must be unaffected — if it fails, something did read `chapter.partners` after all and this plan's central assumption was wrong.

- [ ] **Step 2: Frontend typecheck**

`strapi.ts` may still declare `partners` on `Chapter`. Remove it if so:

```bash
cd /Users/nk/Projects/AREAA/areaa-frontend && grep -n "partners" src/types/strapi.ts
cd /Users/nk/Projects/AREAA/areaa-frontend && npm run check
```

Expected: the only `partners` hits are on `PartnerGroupComponent`; 0 errors.

---

## Chunk 6: Verification

### Task 11: Both suites, twice, with no drift

- [ ] **Step 1: Run them**

Note the `cd` on the first line — the preceding task leaves the shell in the frontend repo:

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && pkill -f "strapi develop" ; \
  PATH="/opt/homebrew/bin:$PATH" npm test
cd /Users/nk/Projects/AREAA/areaa-frontend && npm test
cd /Users/nk/Projects/AREAA/areaa-frontend && npm run check
```

Expected: **217 CMS**, **100 frontend**, 0 typecheck errors.

- [ ] **Step 2: Twice, with no row growth**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && \
  sqlite3 .tmp/data.db "SELECT (SELECT COUNT(*) FROM form_submissions) fs, (SELECT COUNT(*) FROM up_users) u, (SELECT COUNT(*) FROM components_shared_partner_groups_partners_lnk) pl;"
cd /Users/nk/Projects/AREAA/areaa-cms && pkill -f "strapi develop" ; \
  PATH="/opt/homebrew/bin:$PATH" npm test
cd /Users/nk/Projects/AREAA/areaa-cms && \
  sqlite3 .tmp/data.db "SELECT (SELECT COUNT(*) FROM form_submissions) fs, (SELECT COUNT(*) FROM up_users) u, (SELECT COUNT(*) FROM components_shared_partner_groups_partners_lnk) pl;"
```

Expected: **identical rows**, and `pl` = 22.

---

### Task 12: Prove it in a browser

- [ ] **Step 1: Start both servers**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && PATH="/opt/homebrew/bin:$PATH" node ./node_modules/.bin/strapi develop &
cd /Users/nk/Projects/AREAA/areaa-frontend && npm run dev &
```

- [ ] **Step 2: Walk it**

| # | Action | Expected |
|---|---|---|
| 1 | `/contact`, submit a real message | Redirect to `?contact=sent`; the success panel replaces the form |
| 2 | Strapi admin → Form Submissions | **The row is there** — the claim this plan exists to make |
| 3 | `/contact`, submit with the Message box empty | Native validation blocks it; disable JS and it returns `?contact=invalid` with a real reason, form still on screen |
| 4 | **Disable JavaScript**, repeat row 1 | Works identically — there is no client-side script left |
| 5 | Visit a chapter microsite, e.g. `/chapters/aloha-hawaii` | **A contact form now renders**, with the fields the CMS configures |
| 6 | Submit it | `?contact=sent` on the microsite URL |
| 7 | Log in as `chapadmin@areaa.test` → Submissions | **The row appears**, scoped to that chapter — plan 3's screen has data for the first time |
| 8 | Overview page | Submissions tile shows `1 · awaiting reply` and is highlighted |
| 9 | Mark it handled | Tile returns to `all handled` |
| 10 | Submit 6+ times quickly from `/contact` | `?contact=throttled` once the window fills |
| 11 | Fill the honeypot via devtools and submit | `?contact=sent`, but **no new row** in the admin panel |
| 12 | `/chapters/aloha-hawaii` partner grid | Still two logos, in order — Chunk 5 changed nothing visible |

- [ ] **Step 3: Confirm the rate limiter sees real client IPs**

If row 10 throttles after one submission from a second browser, `X-Forwarded-For` is not being honoured and every visitor shares a bucket. Record it as a limitation and open a follow-up rather than leaving it undiagnosed.

- [ ] **Step 4: Clean up and stop**

Delete the walkthrough's submissions through the Strapi admin panel, then:

```bash
pkill -f "strapi develop" ; pkill -f "astro dev" ; sleep 2
cd /Users/nk/Projects/AREAA/areaa-cms && git status --short
cd /Users/nk/Projects/AREAA/areaa-frontend && git status --short
```

---

## Done when

- **217 CMS and 100 frontend tests green**, CMS twice with no row growth.
- A visitor submits `/contact` **with JavaScript disabled** and a row appears in `form_submissions`. The old behaviour — a success message and nothing written — is gone.
- A failed send says so. The success panel renders **only** when the server confirmed receipt.
- A chapter microsite **renders its configured contact form**, and a submission through it lands on that chapter's admin screen. Six component slots stop being dead.
- The chapter is derived from the page server-side; a payload naming its own `chapter` or `handled` is ignored.
- Honeypot and instant submissions return 200 and write nothing. A full window returns 429.
- `GET /api/form-submissions` is **403 for the public**.
- `chapter.partners` and `partner.chapters` are gone from both schemas, `chapters_partners_lnk` no longer exists, and the microsite partner grid is unchanged at 22 component links.
- `docs/2026-08-04-contact-form-sends-nothing.md` is deleted, its surviving caveats moved here.

## Not in this plan

- **Email notification.** No provider is configured. `notificationEmails` stays unread, and the adapter deliberately does not carry it to the browser.
- **A national submissions inbox.** `/contact` submissions have no chapter, so no chapter admin sees them; the Strapi admin panel is the inbox. A national screen is its own plan.
- **reCAPTCHA.** The endpoint takes an extra guard additively when keys exist.
- **Pagination on the submissions screen.** Still `limit: 200`. It has been invisible while nothing was captured; **this plan makes it reachable**, so it is now a real cap rather than a theoretical one.
- **`shared.form-field` type `checkbox`.** Dropped in both the adapter and the server. Adding it means a control in `FormField.astro` and a case in `capture.js`.

## Known limitations, accepted

- **The rate limiter is in-memory and per-process.** It resets on restart, and a multi-instance deploy multiplies the effective limit by the instance count. Redis is the fix when there is more than one instance.
- **The fill-timing check is forgeable.** `renderedAt` is an unsigned client value; a bot can set it to anything. It is a cost-raiser, not a control. Signing it with the app secret would close this and is a small follow-up.
- **A missing or unparseable timestamp is accepted.** Deliberate: refusing a real enquiry from a stale cached page is worse than accepting a possible bot, and two other checks still apply.
- **`X-Forwarded-For` must be trusted for per-visitor limiting.** If Strapi is not configured to trust the proxy, every visitor shares one bucket — safe but blunt. Task 12 Step 3 checks this.
- **Submissions are stored unencrypted**, including whatever a visitor types into a free-text box. No new exposure — the admin screen already reads them — but this plan is what starts putting real data there.
- **No spam quarantine.** Honeypot and timing hits are discarded silently, so a false positive is unrecoverable and invisible. A `spam` boolean instead of a discard would make them auditable; deferred.
- **`shared.contact-form` fields are trusted from the CMS.** A national admin can configure a field named anything; the server stores it. That is the intended authoring power, not a hole, but it means `data` keys are not a fixed schema.
