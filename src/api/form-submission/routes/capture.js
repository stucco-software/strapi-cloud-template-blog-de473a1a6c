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
