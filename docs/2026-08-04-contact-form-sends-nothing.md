# Contact form reports success without sending anything

**Severity:** live on the public site.

`src/components/ContactForm.astro` (areaa-frontend) intercepts submit, calls
`preventDefault()` (line 54), hides the form, and shows **"Thank you — your
message is on its way."** (line 37). Nothing is posted anywhere. Its own comment
says so, at lines 45–46:

> Presentational submit: no backend wired yet, so show a success state in place
> of the form. (When ready, POST to /api/form-submissions here.)

`form_submissions` holds 0 rows and `scripts/seed.js` creates none.

Every contact enquiry made through the site since launch has been silently
discarded, and the visitor was told otherwise.

## Two ways out, in order of preference

1. **Wire capture** — a validated public endpoint writing `api::form-submission`,
   with spam handling, rate limiting and chapter/page association. The chapter
   admin screen built in plan 3 then has data to show. Note the admin side is
   already complete and tested: `GET /api/chapter-admin/submissions` and the
   handled toggle both work, verified against seeded records.
2. **If that is not happening soon, change the copy** so it stops claiming the
   message was sent, and point people at a real email address. A page that
   silently drops enquiries is bad; one that lies about it is worse.

## Why plan 3 did not fix it

Deliberate refusal to widen scope. A public write endpoint is its own subsystem
— spam handling, rate limiting, a Public-role grant, chapter association — none
of which the chapter-admin design document scoped. Building it as a side effect
of an authoring plan would have meant designing all of that without review.

Filed as its own document because the finding was originally a prose note inside
plan 3, and would have died when that plan closed.
