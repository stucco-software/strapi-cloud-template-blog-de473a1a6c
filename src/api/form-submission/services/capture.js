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
