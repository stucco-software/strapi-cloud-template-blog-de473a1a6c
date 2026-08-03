# Chapter Admin — Plan 2: Identity Plumbing and Events Authoring UI

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A chapter admin logs in, lands on their chapter, and creates, edits, and deletes their chapter's events — with an image — in a browser, with no client JS.

**Architecture:** Astro SSR pages under `/account/chapter/[chapterSlug]/…` post to Astro API routes, which forward to the `/api/chapter-admin/*` endpoints built in plan 1 using the member's session JWT. The browser never sees the token. Authorization is still enforced in Strapi; the frontend guard is UX only.

**Tech Stack:** Astro 6.4, TypeScript strict, Vitest 3, Node 24.

**Spec:** [`2026-08-03-chapter-admin-authoring-design.md`](./2026-08-03-chapter-admin-authoring-design.md).
**Predecessor:** [`plan 1`](./2026-08-03-chapter-admin-plan-1-authorization-spine.md) — complete, 58 tests green.

---

## Scope

The spec's rollout step 2 bundled "the remaining resources" in with the frontend. That is too much for one plan: plan 1 built routes for **events and media only**, so news, page, committees, chapter, members, partners and submissions still need backend work *and* screens.

This plan is therefore the frontend equivalent of plan 1's vertical slice — **identity plumbing plus events end-to-end**. It proves the whole frontend pattern against the one API that exists. What follows:

- **Plan 3** — the remaining six resources, backend routes and screens together. Repetition against two proven spines.
- **Plan 4** — TipTap and the `blocksToDoc` / `docToBlocks` converters.

`event.description` is a `blocks` field. Until plan 4, this plan uses a plain textarea and a `textToBlocks` helper that produces paragraph blocks — a deliberate placeholder, called out in the UI copy so nobody mistakes it for the finished editor.

---

## Preconditions

**Node 24** for anything touching the CMS repo (`better-sqlite3` is built for module version 137). The Astro repo is fine on either.

**Two repos.** Every command block states its own `cd`; agent shells reset cwd between calls.

| Repo | Path |
|---|---|
| CMS | `/Users/nk/Projects/AREAA/areaa-cms` |
| Frontend | `/Users/nk/Projects/AREAA/areaa-frontend` |

**The CMS dev server must be running** for the frontend to fetch anything. Start it with the Node 24 binary:

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && PATH="/opt/homebrew/bin:$PATH" \
  node ./node_modules/.bin/strapi develop
```

---

## The API contract, as built

Read from the shipped code, not from plan 1's draft. All routes require the `Chapter Admin` role.

| Route | Body / params | Returns |
|---|---|---|
| `GET /api/chapter-admin/events` | `?page=&pageSize=` | `{ data: [...], meta: { pagination: { page, pageSize, total, pageCount } } }` |
| `POST /api/chapter-admin/events` | `{ chapterSlug, title, startsAt, endsAt, description, memberPrice, publicPrice, location, locationUrl, figure }` | `{ data: <event> }` |
| `PUT /api/chapter-admin/events/:documentId` | same minus `chapterSlug` | `{ data: <event> }` |
| `DELETE /api/chapter-admin/events/:documentId` | — | `{ data: { documentId } }` |
| `POST /api/chapter-admin/media` | multipart, field name **`files`**, one file | `{ data: { id, url, name } }` |

Facts that shape the UI:

- **`chapterSlug` is required on create and ignored on update.** Update reads the owning chapter from the stored record; sending it changes nothing.
- **`slug` is set once at create and is not editable.** Do not render a slug field.
- **`figure` takes a media id**, so the image must be uploaded first and its id threaded into the event payload.
- Errors: `403` out of scope, `400` validation (including an unslugifiable title), `404` missing.
- `description` is `blocks` — an array of AST nodes, not a string.

---

## File Structure

**CMS repo — create/modify:**

| Path | Change |
|---|---|
| `src/extensions/users-permissions/strapi-server.js` | `readSelf` also returns `role` and `administeredChapters` |

**Frontend repo — create:**

| Path | Responsibility |
|---|---|
| `vitest.config.ts` | Test runner |
| `src/lib/pagination.ts` | `pageItems()`, moved out of `members.astro` |
| `src/lib/blocks.ts` | Pure `textToBlocks` / `blocksToText` |
| `src/lib/event-form.ts` | Pure. FormData → event payload, and validation. |
| `src/lib/chapter-admin.ts` | Typed client for `/api/chapter-admin/*` |
| `src/pages/api/chapter-admin/event.ts` | Form POST → save or delete |
| `src/pages/api/chapter-admin/media.ts` | Multipart forward (used by the event form) |
| `src/layouts/ChapterAdminLayout.astro` | Sidebar + chapter context |
| `src/pages/account/chapter/index.astro` | Redirect to the admin's chapter |
| `src/pages/account/chapter/[chapterSlug]/index.astro` | Chapter dashboard |
| `src/pages/account/chapter/[chapterSlug]/events/index.astro` | Event list |
| `src/pages/account/chapter/[chapterSlug]/events/new.astro` | Create form |
| `src/pages/account/chapter/[chapterSlug]/events/[documentId].astro` | Edit form |
| `tests/unit/*.test.ts` | Pagination, blocks, event-form |

**Frontend repo — modify:** `src/lib/account.ts`, `src/lib/auth.ts`, `src/middleware.ts`, `src/components/FormField.astro`, `src/pages/account/members.astro`, `src/layouts/AccountLayout.astro`, `package.json`.

**Why a separate `ChapterAdminLayout`:** `AccountLayout` renders `ACCOUNT_NAV`, which is the member's own account. The chapter-admin area is a different navigation set scoped to a chapter, and bolting a conditional branch into `AccountLayout` would make one file serve two audiences.

---

## Chunk 1: Identity plumbing

### Task 1: Return role and administered chapters from `/users/me`

The built `readSelf` returns `chapter` and the self-visible private fields, but not `role` or `administeredChapters`. Nothing downstream can tell a chapter admin from an ordinary member until it does.

**Files:** Modify `areaa-cms/src/extensions/users-permissions/strapi-server.js`

- [ ] **Step 1: Extend the populate and the re-attach**

In `readSelf`, change the `findOne` populate to include role and administered chapters, and re-attach both after sanitizing:

```js
  const readSelf = async (ctx) => {
    const user = await strapi
      .documents('plugin::users-permissions.user')
      .findOne({
        documentId: ctx.state.user.documentId,
        populate: {
          chapter: { fields: ['name', 'slug'] },
          // The sanitizer drops both of these — `role` is private on the user
          // model and the Authenticated role has no chapter read-grant — so
          // they are re-attached below, same as `chapter`.
          role: { fields: ['name', 'type'] },
          administeredChapters: { fields: ['name', 'slug'] },
        },
      });

    const body = await sanitizeOutput(user, ctx);
    if (user?.chapter) {
      body.chapter = { name: user.chapter.name, slug: user.chapter.slug };
    }
    if (user?.role) {
      body.role = { name: user.role.name, type: user.role.type };
    }
    // Drives the whole chapter-admin surface on the frontend. Always an array,
    // never undefined, so callers need no guard.
    body.administeredChapters = (user?.administeredChapters ?? []).map((c) => ({
      name: c.name,
      slug: c.slug,
    }));

    for (const field of SELF_VISIBLE_PRIVATE_FIELDS) {
      if (user && field in user) body[field] = user[field];
    }
    return body;
  };
```

- [ ] **Step 2: Verify against a chapter admin**

Create one, then read `/users/me` as them:

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && PATH="/opt/homebrew/bin:$PATH" node -e "
const { createStrapi, compileStrapi } = require('@strapi/strapi');
(async () => {
  const app = await createStrapi(await compileStrapi()).load();
  app.log.level = 'error';
  const role = await app.query('plugin::users-permissions.role').findOne({ where: { type: 'chapter_admin' } });
  const chapter = await app.documents('api::chapter.chapter').findFirst({ fields: ['slug'], status: 'draft' });
  const email = 'chapadmin@areaa.test';
  let user = await app.query('plugin::users-permissions.user').findOne({ where: { email } });
  if (!user) {
    user = await app.plugin('users-permissions').service('user').add({
      username: email, email, password: 'Password123!', confirmed: true,
      firstName: 'Chapter', lastName: 'Admin', role: role.id,
      administeredChapters: [chapter.id],
    });
  } else {
    await app.query('plugin::users-permissions.user').update({
      where: { id: user.id }, data: { role: role.id, administeredChapters: [chapter.id] },
    });
  }
  console.log('admin for chapter:', chapter.slug);
  await app.destroy(); process.exit(0);
})();
"
```

Then, with the dev server running:

```bash
JWT=$(curl -s -X POST http://localhost:1337/api/auth/local -H "Content-Type: application/json" \
  -d '{"identifier":"chapadmin@areaa.test","password":"Password123!"}' \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['jwt'])")
curl -s -H "Authorization: Bearer $JWT" http://localhost:1337/api/users/me \
  | python3 -m json.tool | grep -A4 -E '"role"|"administeredChapters"'
```

Expected: a `role` object with `"type": "chapter_admin"`, and `administeredChapters` containing one `{name, slug}`.

- [ ] **Step 3: Confirm an ordinary member gets an empty array, not an error**

```bash
JWT2=$(curl -s -X POST http://localhost:1337/api/auth/local -H "Content-Type: application/json" \
  -d '{"identifier":"mei.tanaka@areaa.example","password":"Password123!"}' \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['jwt'])")
curl -s -H "Authorization: Bearer $JWT2" http://localhost:1337/api/users/me \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print('role:', d.get('role',{}).get('type'), '| administered:', d.get('administeredChapters'))"
```

Expected: `role: authenticated | administered: []`.

- [ ] **Step 4: Confirm nothing leaked to anonymous callers**

```bash
curl -s "http://localhost:1337/api/users" | grep -c '"role"' || echo "0 — clean"
```

Expected: `0 — clean`. `role` is private on the user model; re-attaching it in `me` must not change that.

- [ ] **Step 5: Commit**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && \
  git add src/extensions/users-permissions/strapi-server.js && \
  git commit -m "feat: return role and administeredChapters from /users/me" && \
  git push origin main
```

---

### Task 2: Carry it through `AccountMember`

**Files:** Modify `areaa-frontend/src/lib/account.ts`, `src/lib/auth.ts`

- [ ] **Step 1: Extend the type**

In `src/lib/account.ts`, add to `AccountMember`:

```ts
    /** Chapters this member may administer. Empty for ordinary members. */
    administeredChapters: { name: string; slug: string }[];
```

and below the interface:

```ts
/** True when the member administers the given chapter slug. */
export function administers(member: AccountMember, chapterSlug: string): boolean {
    return member.administeredChapters.some((c) => c.slug === chapterSlug);
}

/** True when the member administers any chapter at all. */
export function isChapterAdmin(member: AccountMember): boolean {
    return member.administeredChapters.length > 0;
}
```

- [ ] **Step 2: Map it in `toAccountMember`**

In `src/lib/auth.ts`, add to the `StrapiUser` interface:

```ts
  role?: { name?: string; type?: string } | null;
  administeredChapters?: { name: string; slug: string }[];
```

and to the object `toAccountMember` returns:

```ts
    administeredChapters: u.administeredChapters ?? [],
```

- [ ] **Step 3: Typecheck**

```bash
cd /Users/nk/Projects/AREAA/areaa-frontend && npm run check
```

Expected: no new errors. (Pre-existing warnings in untouched files are fine; new errors in `account.ts` / `auth.ts` are not.)

- [ ] **Step 4: Commit**

```bash
cd /Users/nk/Projects/AREAA/areaa-frontend && \
  git add src/lib/account.ts src/lib/auth.ts && \
  git commit -m "feat: carry administeredChapters through AccountMember"
```

---

### Task 3: Guard `/account/chapter/*`

This is a **UX guard, not the security boundary** — it stops a member seeing a screen they cannot use. Enforcement is plan 1's scope rule in Strapi, which holds against a direct POST.

**Files:** Modify `areaa-frontend/src/middleware.ts`

- [ ] **Step 1: Add the check**

After the existing `/account` guard, before `return next()`:

```ts
  // Chapter-admin area. The member is signed in by now, so a guest has already
  // been bounced above; what is checked here is whether THIS member administers
  // THIS chapter. Sending them to their own account rather than to /login,
  // because a login prompt would be a lie — they are logged in.
  //
  // UX guard only. Strapi enforces scope on every write regardless.
  if (url.pathname.startsWith("/account/chapter")) {
    const match = url.pathname.match(/^\/account\/chapter\/([^/]+)/);
    const slug = match?.[1];
    const user = locals.user!;

    if (!slug) {
      // Bare /account/chapter — send them to their first chapter, or away.
      const first = user.administeredChapters[0];
      return context.redirect(first ? `/account/chapter/${first.slug}` : "/account");
    }
    if (!user.administeredChapters.some((c) => c.slug === slug)) {
      return context.redirect("/account?error=not-chapter-admin");
    }
  }
```

- [ ] **Step 2: Typecheck**

```bash
cd /Users/nk/Projects/AREAA/areaa-frontend && npm run check
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
cd /Users/nk/Projects/AREAA/areaa-frontend && \
  git add src/middleware.ts && \
  git commit -m "feat: guard the chapter-admin area"
```

---

## Chunk 2: Frontend test harness and pure helpers

### Task 4: Add Vitest to the frontend

**Files:** Modify `package.json`, create `vitest.config.ts`

- [ ] **Step 1: Install**

```bash
cd /Users/nk/Projects/AREAA/areaa-frontend && npm install --save-dev vitest@^3
```

- [ ] **Step 2: Add scripts**

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        environment: "node",
        include: ["tests/**/*.test.ts"],
        passWithNoTests: true,
    },
});
```

- [ ] **Step 4: Verify**

```bash
cd /Users/nk/Projects/AREAA/areaa-frontend && npm test
```

Expected: exit 0, "No test files found".

- [ ] **Step 5: Commit**

```bash
cd /Users/nk/Projects/AREAA/areaa-frontend && \
  git add package.json package-lock.json vitest.config.ts && \
  git commit -m "test: add vitest"
```

---

### Task 5: Extract the pagination helper

`pageItems()` lives inside `account/members.astro`. The event list needs it too; copying it a second time is how three copies happen.

**Files:** Create `src/lib/pagination.ts`, `tests/unit/pagination.test.ts`; modify `src/pages/account/members.astro`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { pageItems } from "../../src/lib/pagination";

describe("pageItems", () => {
    it("lists every page when there are few", () => {
        expect(pageItems(1, 5)).toEqual([1, 2, 3, 4, 5]);
    });

    it("windows around the current page when there are many", () => {
        expect(pageItems(5, 20)).toEqual([1, "…", 4, 5, 6, "…", 20]);
    });

    it("does not emit a leading ellipsis next to page 1", () => {
        expect(pageItems(2, 20)).toEqual([1, 2, 3, "…", 20]);
    });

    it("does not emit a trailing ellipsis next to the last page", () => {
        expect(pageItems(19, 20)).toEqual([1, "…", 18, 19, 20]);
    });

    it("handles a single page", () => {
        expect(pageItems(1, 1)).toEqual([1]);
    });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd /Users/nk/Projects/AREAA/areaa-frontend && npx vitest run tests/unit/pagination.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create the module**

Move the function verbatim out of `members.astro` into `src/lib/pagination.ts`:

```ts
/**
 * Windowed pagination tokens: 1 … (current ± 1) … last.
 * Shared by the member directory and the chapter-admin event list.
 */
export function pageItems(current: number, count: number): (number | "…")[] {
    if (count <= 7) return Array.from({ length: count }, (_, i) => i + 1);
    const out: (number | "…")[] = [1];
    const start = Math.max(2, current - 1);
    const end = Math.min(count - 1, current + 1);
    if (start > 2) out.push("…");
    for (let p = start; p <= end; p++) out.push(p);
    if (end < count - 1) out.push("…");
    out.push(count);
    return out;
}
```

- [ ] **Step 4: Point `members.astro` at it**

Delete the local `function pageItems(...)` from the frontmatter and add to its imports:

```ts
import { pageItems } from "../../lib/pagination";
```

- [ ] **Step 5: Verify tests pass and the directory still renders**

```bash
cd /Users/nk/Projects/AREAA/areaa-frontend && \
  npx vitest run tests/unit/pagination.test.ts && npm run check
```

Expected: 5 tests pass, typecheck clean.

- [ ] **Step 6: Commit**

```bash
cd /Users/nk/Projects/AREAA/areaa-frontend && \
  git add src/lib/pagination.ts tests/unit/pagination.test.ts src/pages/account/members.astro && \
  git commit -m "refactor: extract pageItems to lib"
```

---

### Task 6: Blocks conversion

`event.description` is a Strapi `blocks` AST. Until plan 4 brings TipTap, plain text round-trips through paragraph blocks.

**Files:** Create `src/lib/blocks.ts`, `tests/unit/blocks.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { textToBlocks, blocksToPlainText } from "../../src/lib/blocks";

describe("textToBlocks", () => {
    it("makes one paragraph per line", () => {
        expect(textToBlocks("One\nTwo")).toEqual([
            { type: "paragraph", children: [{ type: "text", text: "One" }] },
            { type: "paragraph", children: [{ type: "text", text: "Two" }] },
        ]);
    });

    it("collapses blank lines rather than emitting empty paragraphs", () => {
        expect(textToBlocks("One\n\n\nTwo")).toHaveLength(2);
    });

    it("normalises CRLF", () => {
        expect(textToBlocks("One\r\nTwo")).toHaveLength(2);
    });

    it("returns an empty array for empty input", () => {
        expect(textToBlocks("")).toEqual([]);
        expect(textToBlocks("   ")).toEqual([]);
    });
});

describe("blocksToPlainText", () => {
    it("round-trips what textToBlocks produced", () => {
        const text = "One\nTwo";
        expect(blocksToPlainText(textToBlocks(text))).toBe(text);
    });

    it("flattens nested children from richer blocks", () => {
        const blocks = [
            { type: "heading", level: 2, children: [{ type: "text", text: "Title" }] },
            { type: "list", format: "unordered", children: [
                { type: "list-item", children: [{ type: "text", text: "Item" }] },
            ] },
        ];
        expect(blocksToPlainText(blocks as never)).toBe("Title\nItem");
    });

    it("tolerates null and malformed input", () => {
        expect(blocksToPlainText(null as never)).toBe("");
        expect(blocksToPlainText([{ type: "paragraph" }] as never)).toBe("");
    });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd /Users/nk/Projects/AREAA/areaa-frontend && npx vitest run tests/unit/blocks.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
import type { StrapiBlock } from "../types/strapi";

/**
 * Plain text <-> Strapi `blocks`.
 *
 * PLACEHOLDER, deliberately. Plan 4 replaces the textarea these serve with
 * TipTap and a real bidirectional converter. Until then a chapter admin can
 * write paragraphs and nothing else, which is why the form labels the field as
 * plain text rather than implying formatting is available.
 *
 * `blocksToPlainText` is lossy on purpose: it flattens whatever the CMS holds
 * (headings, lists, links) down to lines so the textarea can show *something*
 * for content national authored in the block editor.
 */

export function textToBlocks(text: string): StrapiBlock[] {
    return String(text ?? "")
        .replace(/\r\n/g, "\n")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => ({
            type: "paragraph",
            children: [{ type: "text", text: line }],
        })) as StrapiBlock[];
}

export function blocksToPlainText(blocks: StrapiBlock[]): string {
    if (!Array.isArray(blocks)) return "";
    const lines: string[] = [];

    const walk = (node: any): string => {
        if (!node) return "";
        if (typeof node.text === "string") return node.text;
        if (Array.isArray(node.children)) return node.children.map(walk).join("");
        return "";
    };

    for (const block of blocks) {
        const b = block as any;
        // A list contributes one line per item; everything else one line total.
        if (b?.type === "list" && Array.isArray(b.children)) {
            for (const item of b.children) {
                const line = walk(item).trim();
                if (line) lines.push(line);
            }
        } else {
            const line = walk(b).trim();
            if (line) lines.push(line);
        }
    }
    return lines.join("\n");
}
```

- [ ] **Step 4: Run it and watch it pass**

```bash
cd /Users/nk/Projects/AREAA/areaa-frontend && npx vitest run tests/unit/blocks.test.ts
```

Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
cd /Users/nk/Projects/AREAA/areaa-frontend && \
  git add src/lib/blocks.ts tests/unit/blocks.test.ts && \
  git commit -m "feat: plain-text <-> blocks placeholder conversion"
```

---

### Task 7: Form payload mapping

Everything about turning a browser form into an API payload, isolated so it can be tested without a server.

**Files:** Create `src/lib/event-form.ts`, `tests/unit/event-form.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { toEventPayload, validateEventForm } from "../../src/lib/event-form";

const form = (entries: Record<string, string>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(entries)) fd.set(k, v);
    return fd;
};

describe("validateEventForm", () => {
    it("requires a title", () => {
        expect(validateEventForm(form({ title: "" }))).toBe("title-required");
        expect(validateEventForm(form({ title: "   " }))).toBe("title-required");
    });

    it("requires a start date", () => {
        expect(validateEventForm(form({ title: "Gala" }))).toBe("start-required");
    });

    it("rejects an end before the start", () => {
        expect(validateEventForm(form({
            title: "Gala", startsAt: "2026-05-09T10:00", endsAt: "2026-05-09T09:00",
        }))).toBe("end-before-start");
    });

    it("accepts a valid form", () => {
        expect(validateEventForm(form({
            title: "Gala", startsAt: "2026-05-09T10:00", endsAt: "2026-05-09T18:00",
        }))).toBeNull();
    });

    it("accepts an open-ended event", () => {
        expect(validateEventForm(form({ title: "Gala", startsAt: "2026-05-09T10:00" }))).toBeNull();
    });
});

describe("toEventPayload", () => {
    it("maps the flat fields", () => {
        const payload = toEventPayload(form({
            title: " Spring Gala ", startsAt: "2026-05-09T10:00",
            location: "SF", locationUrl: "", memberPrice: "20", publicPrice: "40",
            description: "Line one\nLine two",
        }), { chapterSlug: "boston" });

        expect(payload.title).toBe("Spring Gala");
        expect(payload.chapterSlug).toBe("boston");
        expect(payload.location).toBe("SF");
        expect(payload.memberPrice).toBe(20);
        expect(payload.publicPrice).toBe(40);
        expect(payload.description).toHaveLength(2);
    });

    it("converts datetime-local to an ISO instant", () => {
        const payload = toEventPayload(
            form({ title: "T", startsAt: "2026-05-09T10:00" }), { chapterSlug: "b" });
        expect(payload.startsAt).toMatch(/^2026-05-09T\d{2}:00:00/);
    });

    it("omits empty optional fields rather than sending empty strings", () => {
        const payload = toEventPayload(
            form({ title: "T", startsAt: "2026-05-09T10:00", location: "", memberPrice: "" }),
            { chapterSlug: "b" });
        expect(payload).not.toHaveProperty("location");
        expect(payload).not.toHaveProperty("memberPrice");
        expect(payload).not.toHaveProperty("endsAt");
    });

    it("omits chapterSlug on update — the server reads it from the record", () => {
        const payload = toEventPayload(
            form({ title: "T", startsAt: "2026-05-09T10:00" }), { chapterSlug: null });
        expect(payload).not.toHaveProperty("chapterSlug");
    });

    it("includes figure only when a media id was supplied", () => {
        const base = form({ title: "T", startsAt: "2026-05-09T10:00" });
        expect(toEventPayload(base, { chapterSlug: "b" })).not.toHaveProperty("figure");
        expect(toEventPayload(base, { chapterSlug: "b", figureId: 42 }).figure).toBe(42);
    });

    it("never forwards slug, even if the client sends one", () => {
        const payload = toEventPayload(
            form({ title: "T", startsAt: "2026-05-09T10:00", slug: "attacker-chosen" }),
            { chapterSlug: "b" });
        expect(payload).not.toHaveProperty("slug");
    });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd /Users/nk/Projects/AREAA/areaa-frontend && npx vitest run tests/unit/event-form.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
import { textToBlocks } from "./blocks";
import type { StrapiBlock } from "../types/strapi";

export interface EventPayload {
    title: string;
    startsAt: string;
    chapterSlug?: string;
    endsAt?: string;
    description?: StrapiBlock[];
    location?: string;
    locationUrl?: string;
    memberPrice?: number;
    publicPrice?: number;
    figure?: number;
}

export type EventFormError =
    | "title-required"
    | "start-required"
    | "end-before-start";

const str = (fd: FormData, key: string) => String(fd.get(key) ?? "").trim();

/**
 * Client-shaped validation, mirroring what the API will reject anyway. Doing it
 * here buys a useful message instead of a bare 400 — the server stays the
 * authority.
 */
export function validateEventForm(fd: FormData): EventFormError | null {
    if (!str(fd, "title")) return "title-required";
    if (!str(fd, "startsAt")) return "start-required";

    const start = str(fd, "startsAt");
    const end = str(fd, "endsAt");
    if (end && new Date(end) < new Date(start)) return "end-before-start";

    return null;
}

/**
 * FormData -> API payload.
 *
 * Two deliberate omissions. `slug` is never forwarded: the server sets it once
 * at create and ignores it after, so passing it through would only invite the
 * belief that it is editable. Empty optional fields are dropped rather than sent
 * as "", because the API's whitelist writes exactly what it receives — an empty
 * string would clear a value the member never touched.
 */
export function toEventPayload(
    fd: FormData,
    opts: { chapterSlug: string | null; figureId?: number }
): EventPayload {
    const payload: EventPayload = {
        title: str(fd, "title"),
        // datetime-local has no timezone; the browser means local time, so let
        // Date resolve it and send an unambiguous instant.
        startsAt: new Date(str(fd, "startsAt")).toISOString(),
    };

    if (opts.chapterSlug) payload.chapterSlug = opts.chapterSlug;

    const endsAt = str(fd, "endsAt");
    if (endsAt) payload.endsAt = new Date(endsAt).toISOString();

    for (const field of ["location", "locationUrl"] as const) {
        const value = str(fd, field);
        if (value) payload[field] = value;
    }

    for (const field of ["memberPrice", "publicPrice"] as const) {
        const raw = str(fd, field);
        if (raw !== "") {
            const n = Number(raw);
            if (Number.isFinite(n)) payload[field] = n;
        }
    }

    const description = str(fd, "description");
    if (description) payload.description = textToBlocks(description);

    if (typeof opts.figureId === "number") payload.figure = opts.figureId;

    return payload;
}
```

- [ ] **Step 4: Run it and watch it pass, then the whole suite**

```bash
cd /Users/nk/Projects/AREAA/areaa-frontend && \
  npx vitest run tests/unit/event-form.test.ts && npm test
```

Expected: 12 tests, then 24 across 3 files.

- [ ] **Step 5: Commit**

```bash
cd /Users/nk/Projects/AREAA/areaa-frontend && \
  git add src/lib/event-form.ts tests/unit/event-form.test.ts && \
  git commit -m "feat: event form payload mapping and validation"
```

---

## Chunk 3: The client library

### Task 8: Typed client for the chapter-admin API

Mirrors `lib/directory.ts` in shape, with one deliberate difference: **writes do not fail soft.** `fetchDirectory` returns an empty result on error, which makes a broken read look like an empty one. On a write path that would make a failed save look like a successful one, so these return a discriminated result the caller must handle.

**Files:** Create `src/lib/chapter-admin.ts`

- [ ] **Step 1: Write it**

```ts
// Client for the /api/chapter-admin/* endpoints (see areaa-cms plan 1).
// Server-only: every call carries the member's session JWT, which never reaches
// the browser.
const env = import.meta.env as Record<string, string | undefined>;
const STRAPI_URL =
    process.env.STRAPI_URL || env.STRAPI_URL || "http://localhost:1337";

export interface AdminEvent {
    documentId: string;
    title: string;
    slug: string;
    startsAt?: string;
    endsAt?: string;
    location?: string;
    locationUrl?: string;
    memberPrice?: number;
    publicPrice?: number;
    description?: unknown[];
    figure?: { id: number; url: string } | null;
    chapter?: { name: string; slug: string } | null;
}

export interface Pagination {
    page: number;
    pageSize: number;
    pageCount: number;
    total: number;
}

/**
 * Reads may fail soft to an empty list — but the caller is told which happened,
 * so a broken fetch can render as an error rather than as "no events".
 */
export type ListResult =
    | { ok: true; events: AdminEvent[]; pagination: Pagination }
    | { ok: false; status: number };

export type WriteResult =
    | { ok: true; event: AdminEvent }
    | { ok: false; status: number; message: string };

const EMPTY_PAGINATION: Pagination = { page: 1, pageSize: 25, pageCount: 1, total: 0 };

async function call(
    jwt: string,
    path: string,
    init: RequestInit = {}
): Promise<{ status: number; body: any }> {
    try {
        const res = await fetch(`${STRAPI_URL}/api/chapter-admin${path}`, {
            ...init,
            headers: {
                Authorization: `Bearer ${jwt}`,
                ...(init.body && !(init.body instanceof FormData)
                    ? { "Content-Type": "application/json" }
                    : {}),
                ...(init.headers ?? {}),
            },
        });
        const body = await res.json().catch(() => null);
        return { status: res.status, body };
    } catch {
        return { status: 0, body: null }; // transport failure
    }
}

/** Strapi error bodies are `{ error: { message } }`; fall back to the status. */
function messageOf(body: any, status: number): string {
    return body?.error?.message || `Request failed (${status})`;
}

export async function listEvents(
    jwt: string,
    { page = 1, pageSize = 25 } = {}
): Promise<ListResult> {
    const { status, body } = await call(jwt, `/events?page=${page}&pageSize=${pageSize}`);
    if (status !== 200 || !body?.data) return { ok: false, status };
    return {
        ok: true,
        events: body.data,
        pagination: body.meta?.pagination ?? EMPTY_PAGINATION,
    };
}

export async function getEvent(jwt: string, documentId: string): Promise<AdminEvent | null> {
    // The API has no single-event route; the list is chapter-scoped and small,
    // so find it there rather than adding an endpoint the spec does not define.
    const result = await listEvents(jwt, { pageSize: 100 });
    if (!result.ok) return null;
    return result.events.find((e) => e.documentId === documentId) ?? null;
}

export async function createEvent(jwt: string, payload: unknown): Promise<WriteResult> {
    const { status, body } = await call(jwt, "/events", {
        method: "POST",
        body: JSON.stringify(payload),
    });
    if (status !== 200 || !body?.data) {
        return { ok: false, status, message: messageOf(body, status) };
    }
    return { ok: true, event: body.data };
}

export async function updateEvent(
    jwt: string,
    documentId: string,
    payload: unknown
): Promise<WriteResult> {
    const { status, body } = await call(jwt, `/events/${documentId}`, {
        method: "PUT",
        body: JSON.stringify(payload),
    });
    if (status !== 200 || !body?.data) {
        return { ok: false, status, message: messageOf(body, status) };
    }
    return { ok: true, event: body.data };
}

export async function deleteEvent(
    jwt: string,
    documentId: string
): Promise<{ ok: boolean; status: number }> {
    const { status } = await call(jwt, `/events/${documentId}`, { method: "DELETE" });
    return { ok: status === 200, status };
}

/**
 * Upload one image and return its media id, for threading into `figure`.
 * The field name must be `files` — that is what the endpoint reads.
 */
export async function uploadMedia(
    jwt: string,
    file: File
): Promise<{ ok: true; id: number } | { ok: false; message: string }> {
    const fd = new FormData();
    fd.set("files", file, file.name);
    const { status, body } = await call(jwt, "/media", { method: "POST", body: fd });
    if (status !== 200 || !body?.data?.id) {
        return { ok: false, message: messageOf(body, status) };
    }
    return { ok: true, id: body.data.id };
}
```

- [ ] **Step 2: Typecheck**

```bash
cd /Users/nk/Projects/AREAA/areaa-frontend && npm run check
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
cd /Users/nk/Projects/AREAA/areaa-frontend && \
  git add src/lib/chapter-admin.ts && \
  git commit -m "feat: typed client for the chapter-admin API"
```

---

## Chunk 4: Astro API routes

### Task 9: The event save/delete route

One route handling create, update, and delete, dispatched on a hidden `_action` field — the standard shape for progressive-enhancement forms, where every submit is a plain POST.

**Files:** Create `src/pages/api/chapter-admin/event.ts`

- [ ] **Step 1: Write it**

```ts
import type { APIRoute } from "astro";
import { SESSION_COOKIE } from "../../../lib/auth";
import { administers } from "../../../lib/account";
import { toEventPayload, validateEventForm } from "../../../lib/event-form";
import {
    createEvent, updateEvent, deleteEvent, uploadMedia,
} from "../../../lib/chapter-admin";

export const prerender = false;

/**
 * Handles the event form POST: optionally upload an image, then create, update,
 * or delete, then redirect back with a flash param.
 *
 * All persistence is server-side with the session JWT — the browser never sees
 * the token. No client JS: `_action` is a hidden field rather than a fetch verb.
 *
 * The `administers` check here is a courtesy that produces a decent error page.
 * Strapi enforces scope on every one of these calls regardless, so removing it
 * would cost a nice message, not safety.
 */
export const POST: APIRoute = async ({ request, cookies, redirect, locals }) => {
    const jwt = cookies.get(SESSION_COOKIE)?.value;
    if (!jwt || !locals.user) return redirect("/login?next=/account/chapter", 303);

    const form = await request.formData();
    const action = String(form.get("_action") ?? "save");
    const chapterSlug = String(form.get("chapterSlug") ?? "");
    const documentId = String(form.get("documentId") ?? "");

    if (!chapterSlug || !administers(locals.user, chapterSlug)) {
        return redirect("/account?error=not-chapter-admin", 303);
    }

    const base = `/account/chapter/${chapterSlug}/events`;
    const back = (path: string, params: string) => redirect(`${path}?${params}`, 303);
    const editPath = documentId ? `${base}/${documentId}` : `${base}/new`;

    // --- delete ------------------------------------------------------------
    if (action === "delete") {
        if (!documentId) return back(base, "error=missing");
        const result = await deleteEvent(jwt, documentId);
        return back(base, result.ok ? "deleted=1" : `error=${result.status === 403 ? "forbidden" : "delete"}`);
    }

    // --- validate ----------------------------------------------------------
    const invalid = validateEventForm(form);
    if (invalid) return back(editPath, `error=${invalid}`);

    // --- optional image ----------------------------------------------------
    // Uploaded first so its id can ride along in the same save. An upload whose
    // save then fails leaves an orphan in the media library, which the spec
    // accepts as a known cost.
    let figureId: number | undefined;
    const file = form.get("figure");
    if (file instanceof File && file.size > 0) {
        const upload = await uploadMedia(jwt, file);
        if (!upload.ok) {
            return back(editPath, `error=upload&message=${encodeURIComponent(upload.message)}`);
        }
        figureId = upload.id;
    }

    // --- create or update --------------------------------------------------
    // chapterSlug is required on create and ignored on update, where the server
    // reads the owning chapter from the stored record.
    const isUpdate = Boolean(documentId);
    const payload = toEventPayload(form, {
        chapterSlug: isUpdate ? null : chapterSlug,
        figureId,
    });

    const result = isUpdate
        ? await updateEvent(jwt, documentId, payload)
        : await createEvent(jwt, payload);

    if (!result.ok) {
        if (result.status === 403) return back(editPath, "error=forbidden");
        return back(editPath, `error=save&message=${encodeURIComponent(result.message)}`);
    }

    return back(base, isUpdate ? "saved=1" : "created=1");
};
```

- [ ] **Step 2: Typecheck**

```bash
cd /Users/nk/Projects/AREAA/areaa-frontend && npm run check
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
cd /Users/nk/Projects/AREAA/areaa-frontend && \
  git add src/pages/api/chapter-admin/event.ts && \
  git commit -m "feat: event save/delete API route"
```

---

## Chunk 5: The screens

### Task 10: Chapter-admin layout and entry point

**Files:** Create `src/layouts/ChapterAdminLayout.astro`, `src/pages/account/chapter/index.astro`; modify `src/layouts/AccountLayout.astro`

- [ ] **Step 1: Create the layout**

```astro
---
import MainLayout from "./MainLayout.astro";
import Breadcrumb from "../components/Breadcrumb.astro";

interface Props {
    title: string;
    chapterSlug: string;
    chapterName: string;
    /** Active sidebar key. */
    active: string;
}

const { title, chapterSlug, chapterName, active } = Astro.props;

// Only events exist today; plan 3 adds the rest. Listed here rather than in
// lib/account.ts because this nav is chapter-scoped, not member-scoped.
const NAV = [
    { key: "overview", label: "Overview", href: `/account/chapter/${chapterSlug}` },
    { key: "events", label: "Events", href: `/account/chapter/${chapterSlug}/events` },
];
---

<MainLayout title={title}>
    <Breadcrumb
        items={[
            { label: "Home", href: "/" },
            { label: "Dashboard", href: "/account" },
            { label: chapterName },
        ]}
    />

    <section class="chadmin">
        <div class="chadmin__inner">
            <aside class="chadmin__sidebar" aria-label="Chapter administration">
                <p class="chadmin__chapter">{chapterName}</p>
                <nav>
                    <ul>
                        {NAV.map((item) => (
                            <li>
                                <a
                                    href={item.href}
                                    class:list={["chadmin__link", { "chadmin__link--active": item.key === active }]}
                                    aria-current={item.key === active ? "page" : undefined}
                                >{item.label}</a>
                            </li>
                        ))}
                    </ul>
                </nav>
            </aside>
            <div class="chadmin__main"><slot /></div>
        </div>
    </section>
</MainLayout>

<style>
    .chadmin {
        background-color: var(--primitive-neutral-50);
        color: var(--primitive-neutral-900);
        padding: var(--space-800) var(--space-1600) var(--space-2400);
        width: 100%;
        min-height: 60vh;
    }
    .chadmin__inner {
        display: grid;
        grid-template-columns: 262px 1fr;
        gap: var(--space-1600);
        margin: 0 auto;
        max-width: 1180px;
    }
    .chadmin__sidebar { position: sticky; top: var(--space-800); align-self: start; }
    .chadmin__chapter {
        margin: 0 0 var(--space-600);
        font-family: var(--font-family-header);
        font-size: 20px;
        color: var(--primitive-neutral-900);
    }
    .chadmin__sidebar ul {
        display: flex; flex-direction: column; gap: var(--space-600);
        margin: 0; padding: 0; list-style: none;
    }
    .chadmin__link {
        font-family: var(--font-family-body); font-size: 16px; font-weight: 600;
        color: var(--primitive-neutral-700); text-decoration: none;
    }
    .chadmin__link:hover, .chadmin__link:focus-visible { color: var(--primitive-brand-500); }
    .chadmin__link--active { color: var(--primitive-brand-500); }
    .chadmin__main { min-width: 0; }

    @media (max-width: 1024px) {
        .chadmin { padding: var(--space-800) var(--space-1200) var(--space-1600); }
        .chadmin__inner { gap: var(--space-1200); }
    }
    @media (max-width: 768px) {
        .chadmin { padding: var(--space-800) var(--space-600) var(--space-1600); }
        .chadmin__inner { grid-template-columns: 1fr; gap: var(--space-800); }
        .chadmin__sidebar { position: static; }
        .chadmin__sidebar ul { flex-direction: row; flex-wrap: wrap; gap: var(--space-400) var(--space-600); }
    }
</style>
```

- [ ] **Step 2: Create the entry redirect**

`src/pages/account/chapter/index.astro`:

```astro
---
// Bare /account/chapter — the middleware already redirected an admin to their
// first chapter and a non-admin away, so reaching this file means neither
// applied. Send them somewhere sensible rather than rendering an empty shell.
export const prerender = false;

const member = Astro.locals.user;
if (!member) return Astro.redirect("/login?next=/account/chapter");

const first = member.administeredChapters[0];
return Astro.redirect(first ? `/account/chapter/${first.slug}` : "/account");
---
```

- [ ] **Step 3: Add the nav entry for chapter admins**

In `AccountLayout.astro`, after the `ACCOUNT_NAV` list, render an extra group only when the member administers something:

```astro
{
    Astro.locals.user && Astro.locals.user.administeredChapters.length > 0 && (
        <>
            <p class="account__nav-heading">Chapter Admin</p>
            <ul>
                {Astro.locals.user.administeredChapters.map((c) => (
                    <li>
                        <a href={`/account/chapter/${c.slug}`} class="account__nav-link">
                            {c.name}
                        </a>
                    </li>
                ))}
            </ul>
        </>
    )
}
```

with matching style:

```css
    .account__nav-heading {
        margin: var(--space-800) 0 var(--space-400);
        font-family: var(--font-family-body);
        font-size: 12px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--primitive-neutral-500);
    }
```

The surface stays invisible to ordinary members — nobody sees a door they cannot open.

- [ ] **Step 4: Typecheck and commit**

```bash
cd /Users/nk/Projects/AREAA/areaa-frontend && npm run check && \
  git add src/layouts/ChapterAdminLayout.astro src/pages/account/chapter/index.astro src/layouts/AccountLayout.astro && \
  git commit -m "feat: chapter-admin layout and entry point"
```

---

### Task 11: Chapter overview

**Files:** Create `src/pages/account/chapter/[chapterSlug]/index.astro`

- [ ] **Step 1: Write it**

```astro
---
import ChapterAdminLayout from "../../../../layouts/ChapterAdminLayout.astro";
import { SESSION_COOKIE } from "../../../../lib/auth";
import { listEvents } from "../../../../lib/chapter-admin";

export const prerender = false;

// Middleware guarantees the member administers this slug; assert for narrowing.
const member = Astro.locals.user;
if (!member) return Astro.redirect("/login");

const { chapterSlug } = Astro.params;
const chapter = member.administeredChapters.find((c) => c.slug === chapterSlug);
if (!chapter) return Astro.redirect("/account?error=not-chapter-admin");

const jwt = Astro.cookies.get(SESSION_COOKIE)?.value ?? "";
const result = await listEvents(jwt, { pageSize: 5 });

// Distinguish "no events" from "could not load them" — a failed read must not
// render as an empty one.
const failed = !result.ok;
const events = result.ok ? result.events : [];
const total = result.ok ? result.pagination.total : 0;
---

<ChapterAdminLayout
    title={`${chapter.name} | Chapter Admin | AREAA`}
    chapterSlug={chapter.slug}
    chapterName={chapter.name}
    active="overview"
>
    <h1 class="ov__title">{chapter.name}</h1>

    {failed && (
        <p class="ov__error" role="alert">
            Couldn't load this chapter's events. Please refresh, or try again shortly.
        </p>
    )}

    <section class="ov__panel">
        <div class="ov__panel-head">
            <h2 class="ov__subhead">Events</h2>
            <a href={`/account/chapter/${chapter.slug}/events/new`} class="btn btn--primary">
                Add Event
            </a>
        </div>

        {!failed && total === 0 && (
            <p class="ov__empty">
                No events yet. <a href={`/account/chapter/${chapter.slug}/events/new`}>Create the first one.</a>
            </p>
        )}

        {events.length > 0 && (
            <ul class="ov__list">
                {events.map((e) => (
                    <li class="ov__row">
                        <a href={`/account/chapter/${chapter.slug}/events/${e.documentId}`}>{e.title}</a>
                        <span class="ov__date">
                            {e.startsAt
                                ? new Date(e.startsAt).toLocaleDateString("en-US", {
                                      month: "long", day: "numeric", year: "numeric",
                                  })
                                : "No date"}
                        </span>
                    </li>
                ))}
            </ul>
        )}

        {total > events.length && (
            <a href={`/account/chapter/${chapter.slug}/events`} class="btn btn--secondary">
                View all {total}
            </a>
        )}
    </section>
</ChapterAdminLayout>

<style>
    .ov__title {
        margin: 0 0 var(--space-1200);
        font-family: var(--font-family-header);
        font-weight: 400; font-size: 48px; line-height: 1.2;
    }
    .ov__error {
        margin: 0 0 var(--space-800);
        padding: var(--space-300) var(--space-400);
        border: var(--stroke-border) solid var(--primitive-brand-300);
        border-radius: var(--radius-100);
        background-color: var(--primitive-brand-50);
        color: var(--primitive-brand-700);
        font-family: var(--font-family-body);
    }
    .ov__panel { display: flex; flex-direction: column; gap: var(--space-600); align-items: flex-start; }
    .ov__panel-head {
        display: flex; align-items: center; justify-content: space-between;
        gap: var(--space-800); width: 100%;
    }
    .ov__subhead {
        margin: 0; font-family: var(--font-family-header);
        font-weight: 700; font-size: 24px; line-height: 1.1;
    }
    .ov__empty, .ov__date { font-family: var(--font-family-body); color: var(--primitive-neutral-700); }
    .ov__list { width: 100%; margin: 0; padding: 0; list-style: none;
        display: flex; flex-direction: column; gap: var(--space-300); }
    .ov__row {
        display: flex; align-items: center; justify-content: space-between;
        gap: var(--space-600); padding: var(--space-400);
        background-color: var(--primitive-neutral-100); border-radius: var(--radius-100);
        font-family: var(--font-family-body);
    }
    .ov__row a { color: var(--primitive-brand-500); text-decoration: none; font-weight: 600; }
    .ov__row a:hover, .ov__row a:focus-visible { text-decoration: underline; }
    @media (max-width: 768px) {
        .ov__title { font-size: 36px; }
        .ov__panel-head { flex-direction: column; align-items: flex-start; }
        .ov__row { flex-direction: column; align-items: flex-start; gap: var(--space-200); }
    }
</style>
```

- [ ] **Step 2: Typecheck and commit**

```bash
cd /Users/nk/Projects/AREAA/areaa-frontend && npm run check && \
  git add "src/pages/account/chapter/[chapterSlug]/index.astro" && \
  git commit -m "feat: chapter admin overview"
```

---

### Task 12: `FormField` additions

**Files:** Modify `src/components/FormField.astro`

- [ ] **Step 1: Widen the type union**

```ts
    type?:
        | "text"
        | "email"
        | "tel"
        | "password"
        | "search"
        | "select"
        | "textarea"
        | "datetime-local"
        | "number"
        | "file";
```

- [ ] **Step 2: Add the props the new types need**

```ts
    /** `number` only. */
    step?: string;
    min?: string;
    /** `file` only — e.g. "image/jpeg,image/png,image/webp,image/avif". */
    accept?: string;
```

destructure them alongside the others, and pass them to the `<input>`:

```astro
                step={type === "number" ? (step ?? "0.01") : undefined}
                min={type === "number" ? (min ?? "0") : undefined}
                accept={type === "file" ? accept : undefined}
```

A `file` input must not receive a `value`, so guard it:

```astro
                value={type === "file" ? undefined : value}
```

- [ ] **Step 3: Verify the existing forms still render**

```bash
cd /Users/nk/Projects/AREAA/areaa-frontend && npm run check
```

Expected: clean. `FormField` is used by login, profile, contact and the directory — a regression here breaks all of them.

- [ ] **Step 4: Commit**

```bash
cd /Users/nk/Projects/AREAA/areaa-frontend && \
  git add src/components/FormField.astro && \
  git commit -m "feat: datetime-local, number and file field types"
```

---

### Task 13: The event form

One component behind both create and edit, because they differ only in whether `documentId` is present.

**Files:** Create `src/components/EventForm.astro`

- [ ] **Step 1: Write it**

```astro
---
import FormField from "./FormField.astro";
import { blocksToPlainText } from "../lib/blocks";
import type { AdminEvent } from "../lib/chapter-admin";

interface Props {
    chapterSlug: string;
    /** Absent when creating. */
    event?: AdminEvent | null;
    error?: string | null;
}

const { chapterSlug, event = null, error = null } = Astro.props;
const isEdit = Boolean(event?.documentId);

// datetime-local wants `YYYY-MM-DDTHH:mm` in LOCAL time; the API returns UTC ISO.
const forInput = (iso?: string) => {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const messages: Record<string, string> = {
    "title-required": "Give the event a title.",
    "start-required": "Choose when the event starts.",
    "end-before-start": "The end time is before the start time.",
    forbidden: "You don't have permission to edit this chapter's events.",
    upload: "That image couldn't be uploaded. It must be a JPEG, PNG, WebP or AVIF under 5MB.",
    save: "Something went wrong saving this event. Please try again.",
    missing: "That event could not be found.",
};
const errorMessage = error ? (messages[error] ?? messages.save) : null;
---

<form class="evform" method="post" action="/api/chapter-admin/event" enctype="multipart/form-data" novalidate>
    <input type="hidden" name="_action" value="save" />
    <input type="hidden" name="chapterSlug" value={chapterSlug} />
    {isEdit && <input type="hidden" name="documentId" value={event!.documentId} />}

    {errorMessage && <p class="evform__error" role="alert">{errorMessage}</p>}

    <FormField label="Title" name="title" required value={event?.title ?? ""} placeholder="Spring Gala" />

    <div class="evform__grid">
        <FormField label="Starts" name="startsAt" type="datetime-local" required value={forInput(event?.startsAt)} />
        <FormField label="Ends" name="endsAt" type="datetime-local" value={forInput(event?.endsAt)} helper="Optional." />
    </div>

    <div class="evform__grid">
        <FormField label="Location" name="location" value={event?.location ?? ""} placeholder="Venue, or Online" />
        <FormField label="Location URL" name="locationUrl" value={event?.locationUrl ?? ""} placeholder="https://…" helper="For online events." />
    </div>

    <div class="evform__grid">
        <FormField label="Member Price" name="memberPrice" type="number" value={event?.memberPrice?.toString() ?? ""} placeholder="0" />
        <FormField label="Public Price" name="publicPrice" type="number" value={event?.publicPrice?.toString() ?? ""} placeholder="0" />
    </div>

    <FormField
        label="Description"
        name="description"
        type="textarea"
        value={blocksToPlainText((event?.description ?? []) as never)}
        placeholder="What is this event about?"
        helper="Plain text for now — one paragraph per line. Formatting is coming soon."
    />

    <FormField
        label={event?.figure ? "Replace Image" : "Image"}
        name="figure"
        type="file"
        accept="image/jpeg,image/png,image/webp,image/avif"
        helper="JPEG, PNG, WebP or AVIF, up to 5MB."
    />
    {event?.figure && (
        <p class="evform__current">
            Current image: <a href={event.figure.url} target="_blank" rel="noopener">view</a>
        </p>
    )}

    <div class="evform__actions">
        <button type="submit" class="btn btn--primary">
            {isEdit ? "Save Changes" : "Create Event"}
        </button>
        <a href={`/account/chapter/${chapterSlug}/events`} class="btn btn--secondary">Cancel</a>
    </div>
</form>

{isEdit && (
    <form class="evform__danger" method="post" action="/api/chapter-admin/event">
        <input type="hidden" name="_action" value="delete" />
        <input type="hidden" name="chapterSlug" value={chapterSlug} />
        <input type="hidden" name="documentId" value={event!.documentId} />
        <button type="submit" class="evform__delete">Delete this event</button>
    </form>
)}

<style>
    .evform { display: flex; flex-direction: column; gap: var(--space-600); }
    .evform__grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-600); }
    .evform__error {
        margin: 0; padding: var(--space-300) var(--space-400);
        border: var(--stroke-border) solid var(--primitive-brand-300);
        border-radius: var(--radius-100);
        background-color: var(--primitive-brand-50);
        color: var(--primitive-brand-700);
        font-family: var(--font-family-body); font-size: 16px;
    }
    .evform__current { margin: 0; font-family: var(--font-family-body); font-size: 14px;
        color: var(--primitive-neutral-700); }
    .evform__actions { display: flex; gap: var(--space-400); }
    .evform__danger { margin-top: var(--space-1200); }
    .evform__delete {
        background: none; border: none; padding: 0; cursor: pointer;
        font-family: var(--font-family-body); font-size: 14px;
        color: var(--primitive-neutral-600); text-decoration: underline;
    }
    .evform__delete:hover, .evform__delete:focus-visible { color: var(--primitive-brand-500); }
    @media (max-width: 768px) {
        .evform__grid { grid-template-columns: 1fr; }
        .evform__actions { flex-direction: column; }
        .evform__actions .btn { width: 100%; }
    }
</style>
```

- [ ] **Step 2: Typecheck and commit**

```bash
cd /Users/nk/Projects/AREAA/areaa-frontend && npm run check && \
  git add src/components/EventForm.astro && \
  git commit -m "feat: event form component"
```

---

### Task 14: List, create and edit pages

**Files:** Create the three pages under `src/pages/account/chapter/[chapterSlug]/events/`

- [ ] **Step 1: `index.astro` — the list**

```astro
---
import ChapterAdminLayout from "../../../../../layouts/ChapterAdminLayout.astro";
import { SESSION_COOKIE } from "../../../../../lib/auth";
import { listEvents } from "../../../../../lib/chapter-admin";
import { pageItems } from "../../../../../lib/pagination";

export const prerender = false;

const member = Astro.locals.user;
if (!member) return Astro.redirect("/login");

const { chapterSlug } = Astro.params;
const chapter = member.administeredChapters.find((c) => c.slug === chapterSlug);
if (!chapter) return Astro.redirect("/account?error=not-chapter-admin");

const sp = Astro.url.searchParams;
const page = Math.max(1, parseInt(sp.get("page") ?? "1", 10) || 1);

const jwt = Astro.cookies.get(SESSION_COOKIE)?.value ?? "";
const result = await listEvents(jwt, { page });
const failed = !result.ok;
const events = result.ok ? result.events : [];
const pagination = result.ok ? result.pagination : { page: 1, pageSize: 25, pageCount: 1, total: 0 };

const flash = sp.get("saved") ? "Event saved."
    : sp.get("created") ? "Event created."
    : sp.get("deleted") ? "Event deleted."
    : null;

const base = `/account/chapter/${chapter.slug}/events`;
const items = pageItems(page, pagination.pageCount);
---

<ChapterAdminLayout
    title={`Events | ${chapter.name} | AREAA`}
    chapterSlug={chapter.slug}
    chapterName={chapter.name}
    active="events"
>
    <div class="evlist__head">
        <h1 class="evlist__title">Events</h1>
        <a href={`${base}/new`} class="btn btn--primary">Add Event</a>
    </div>

    {flash && <p class="evlist__flash" role="status">{flash}</p>}
    {failed && (
        <p class="evlist__error" role="alert">
            Couldn't load events. Please refresh, or try again shortly.
        </p>
    )}

    {!failed && events.length === 0 ? (
        <p class="evlist__empty">No events yet. <a href={`${base}/new`}>Create the first one.</a></p>
    ) : (
        <ul class="evlist__list">
            {events.map((e) => (
                <li class="evlist__row">
                    <div>
                        <a class="evlist__name" href={`${base}/${e.documentId}`}>{e.title}</a>
                        <p class="evlist__slug">/events/{e.slug}</p>
                    </div>
                    <span class="evlist__date">
                        {e.startsAt
                            ? new Date(e.startsAt).toLocaleString("en-US", {
                                  month: "long", day: "numeric", year: "numeric",
                                  hour: "numeric", minute: "2-digit",
                              })
                            : "No date"}
                    </span>
                </li>
            ))}
        </ul>
    )}

    {pagination.pageCount > 1 && (
        <nav class="evlist__pagination" aria-label="Event pages">
            <ul>
                {items.map((it) =>
                    it === "…" ? (
                        <li><span>…</span></li>
                    ) : (
                        <li>
                            <a href={`${base}?page=${it}`}
                               class:list={["evlist__page", { "evlist__page--active": it === page }]}
                               aria-current={it === page ? "page" : undefined}>{it}</a>
                        </li>
                    )
                )}
            </ul>
        </nav>
    )}
</ChapterAdminLayout>

<style>
    .evlist__head { display: flex; align-items: center; justify-content: space-between;
        gap: var(--space-800); margin-bottom: var(--space-800); }
    .evlist__title { margin: 0; font-family: var(--font-family-header);
        font-weight: 400; font-size: 48px; line-height: 1.2; }
    .evlist__flash, .evlist__error {
        margin: 0 0 var(--space-600); padding: var(--space-300) var(--space-400);
        border-radius: var(--radius-100); font-family: var(--font-family-body);
        border: var(--stroke-border) solid var(--primitive-brand-300);
        background-color: var(--primitive-brand-50); color: var(--primitive-brand-700);
    }
    .evlist__empty { font-family: var(--font-family-body); color: var(--primitive-neutral-700); }
    .evlist__list { margin: 0; padding: 0; list-style: none;
        display: flex; flex-direction: column; gap: var(--space-300); }
    .evlist__row { display: flex; align-items: center; justify-content: space-between;
        gap: var(--space-600); padding: var(--space-400);
        background-color: var(--primitive-neutral-100); border-radius: var(--radius-100); }
    .evlist__name { font-family: var(--font-family-body); font-weight: 700;
        color: var(--primitive-brand-500); text-decoration: none; }
    .evlist__name:hover, .evlist__name:focus-visible { text-decoration: underline; }
    .evlist__slug { margin: var(--space-100) 0 0; font-family: var(--font-family-body);
        font-size: 13px; color: var(--primitive-neutral-500); }
    .evlist__date { font-family: var(--font-family-body); font-size: 14px;
        color: var(--primitive-neutral-700); white-space: nowrap; }
    .evlist__pagination ul { display: flex; gap: var(--space-300); list-style: none;
        margin: var(--space-800) 0 0; padding: 0; font-family: var(--font-family-body); }
    .evlist__page { color: var(--primitive-neutral-700); text-decoration: none; }
    .evlist__page--active { color: var(--primitive-brand-500); font-weight: 700; }
    @media (max-width: 768px) {
        .evlist__title { font-size: 36px; }
        .evlist__head { flex-direction: column; align-items: flex-start; }
        .evlist__row { flex-direction: column; align-items: flex-start; gap: var(--space-200); }
    }
</style>
```

- [ ] **Step 2: `new.astro` — create**

```astro
---
import ChapterAdminLayout from "../../../../../layouts/ChapterAdminLayout.astro";
import EventForm from "../../../../../components/EventForm.astro";

export const prerender = false;

const member = Astro.locals.user;
if (!member) return Astro.redirect("/login");

const { chapterSlug } = Astro.params;
const chapter = member.administeredChapters.find((c) => c.slug === chapterSlug);
if (!chapter) return Astro.redirect("/account?error=not-chapter-admin");

const error = Astro.url.searchParams.get("error");
---

<ChapterAdminLayout
    title={`New Event | ${chapter.name} | AREAA`}
    chapterSlug={chapter.slug}
    chapterName={chapter.name}
    active="events"
>
    <h1 class="evnew__title">New Event</h1>
    <EventForm chapterSlug={chapter.slug} error={error} />
</ChapterAdminLayout>

<style>
    .evnew__title { margin: 0 0 var(--space-1200); font-family: var(--font-family-header);
        font-weight: 400; font-size: 48px; line-height: 1.2; }
    @media (max-width: 768px) { .evnew__title { font-size: 36px; } }
</style>
```

- [ ] **Step 3: `[documentId].astro` — edit**

```astro
---
import ChapterAdminLayout from "../../../../../layouts/ChapterAdminLayout.astro";
import EventForm from "../../../../../components/EventForm.astro";
import { SESSION_COOKIE } from "../../../../../lib/auth";
import { getEvent } from "../../../../../lib/chapter-admin";

export const prerender = false;

const member = Astro.locals.user;
if (!member) return Astro.redirect("/login");

const { chapterSlug, documentId } = Astro.params;
const chapter = member.administeredChapters.find((c) => c.slug === chapterSlug);
if (!chapter) return Astro.redirect("/account?error=not-chapter-admin");

const jwt = Astro.cookies.get(SESSION_COOKIE)?.value ?? "";
const event = await getEvent(jwt, documentId!);
// getEvent searches the caller's own chapter-scoped list, so a miss means the
// event does not exist OR belongs to someone else — indistinguishable here, and
// a 404 is the right answer either way.
if (!event) return Astro.redirect(`/account/chapter/${chapter.slug}/events?error=missing`);

const error = Astro.url.searchParams.get("error");
---

<ChapterAdminLayout
    title={`${event.title} | ${chapter.name} | AREAA`}
    chapterSlug={chapter.slug}
    chapterName={chapter.name}
    active="events"
>
    <h1 class="evedit__title">Edit Event</h1>
    <EventForm chapterSlug={chapter.slug} event={event} error={error} />
</ChapterAdminLayout>

<style>
    .evedit__title { margin: 0 0 var(--space-1200); font-family: var(--font-family-header);
        font-weight: 400; font-size: 48px; line-height: 1.2; }
    @media (max-width: 768px) { .evedit__title { font-size: 36px; } }
</style>
```

- [ ] **Step 4: Typecheck and commit**

```bash
cd /Users/nk/Projects/AREAA/areaa-frontend && npm run check && \
  git add "src/pages/account/chapter/[chapterSlug]/events/" && \
  git commit -m "feat: event list, create and edit pages"
```

---

## Chunk 6: Verification

### Task 15: Prove it in a browser

Unit tests cover the pure mapping; nothing so far has proved a member can actually do this.

- [ ] **Step 1: Run both suites**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && PATH="/opt/homebrew/bin:$PATH" npm test
cd /Users/nk/Projects/AREAA/areaa-frontend && npm test
```

Expected: 58 tests in the CMS, 24 in the frontend.

- [ ] **Step 2: Start both servers**

```bash
cd /Users/nk/Projects/AREAA/areaa-cms && PATH="/opt/homebrew/bin:$PATH" node ./node_modules/.bin/strapi develop &
cd /Users/nk/Projects/AREAA/areaa-frontend && npm run dev &
```

- [ ] **Step 3: Walk the path**

Sign in at `http://localhost:4321/login` as `chapadmin@areaa.test` / `Password123!` (created in Task 1), then confirm each of:

| # | Action | Expected |
|---|---|---|
| 1 | Land on `/account` | A "Chapter Admin" group in the sidebar naming the chapter |
| 2 | Click it | Chapter overview, events panel |
| 3 | Add Event → fill title + start → Create | Back at the list, "Event created.", the event visible |
| 4 | Check the slug shown | Prefixed with the chapter slug |
| 5 | Open the event, change the location, Save | "Event saved.", the new location persists on reload |
| 6 | Add an image, Save | Reopens showing "Current image: view", and the link opens the file |
| 7 | Try an SVG renamed to `.png` | Rejected with the image error — plan 1's sniffing, reached through the UI |
| 8 | Submit with an empty title | "Give the event a title." — no server round trip needed to be sensible |
| 9 | Delete the event | Back at the list, "Event deleted.", gone |
| 10 | Visit `/account/chapter/<another-chapter>` | Redirected to `/account` |
| 11 | Sign in as `mei.tanaka@areaa.example` | No Chapter Admin group; `/account/chapter` redirects away |

- [ ] **Step 4: Confirm the public site reflects it**

Create an event, then visit `http://localhost:4321/events`. It must appear — that is CA11's explicit publish working end to end, and it is the single most likely thing to be silently wrong.

- [ ] **Step 5: Commit anything outstanding**

```bash
cd /Users/nk/Projects/AREAA/areaa-frontend && git status --short
```

Expected: clean.

---

## Done when

- Both suites green: 58 CMS, 24 frontend.
- A chapter admin can create, edit and delete their chapter's events in a browser with JavaScript disabled.
- An uploaded image attaches, and a disguised SVG is rejected.
- A created event appears on the public `/events` page.
- A member who administers nothing sees no chapter-admin surface and cannot reach one by URL.

## Not in this plan

- The other six resources — news, page, committees, chapter settings, partners, submissions. They need backend routes *and* screens (plan 3).
- TipTap and the real blocks converters (plan 4). `description` is a plain textarea, labelled as such.
- Deleting or reordering a chapter's media.

## Known limitations, accepted

- **`getEvent` fetches up to 100 events and finds one in the list**, because the API has no single-event route. Fine at chapter scale; if a chapter exceeds 100 events the edit page silently stops finding older ones. Add `GET /chapter-admin/events/:documentId` in plan 3 rather than raising the number.
- **An upload whose save then fails leaves an orphan** in the shared media library, which no chapter admin can delete. The spec accepts this.
- **No CSRF token.** Astro's native `checkOrigin` covers these POSTs, the same as every other form on the site — see `server.mjs` for why that works behind CloudFront.
