// Global Vitest setup shared by all tests.
//
// - Registers @testing-library/jest-dom matchers (e.g. toBeInTheDocument).
// - Automatically unmounts React trees rendered with @testing-library/react
//   after each test to keep the jsdom document clean.
//
// Pure/logic tests that don't need a DOM can opt into the node environment by
// adding this docblock at the top of the file:
//   // @vitest-environment node

import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

afterEach(() => {
  cleanup()
})
