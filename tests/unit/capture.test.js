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
