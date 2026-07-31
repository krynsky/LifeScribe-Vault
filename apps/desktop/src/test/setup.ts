// jest-dom's "/vitest" entry calls expect.extend() against the `vitest` module
// IT resolves. This repo has two vitest copies on disk (the root install and
// apps/desktop's own), so that can be a different module instance from the one
// the running test file imports — the matchers then land on the wrong `expect`
// and every assertion fails with "Invalid Chai property: toBeInTheDocument".
// Extending explicitly from the raw matchers binds them to the same `expect`
// the tests use, whichever copy that is.
// The "/vitest" import is still needed for its TypeScript declaration merging,
// which is what teaches `expect(...)` about toBeInTheDocument et al.
import "@testing-library/jest-dom/vitest";
import * as matchers from "@testing-library/jest-dom/matchers";
import { cleanup } from "@testing-library/react";
import { afterEach, expect } from "vitest";

expect.extend(matchers);

afterEach(() => {
  cleanup();
});
