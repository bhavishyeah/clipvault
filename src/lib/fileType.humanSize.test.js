// @vitest-environment node
//
// Feature: sharing-enhancements
//
// Unit tests for humanSize(bytes) in ./fileType.js
//
// Validates: Requirements 4.1, 4.2 (File_Card shows the file size)
//
// humanSize formats a byte count into a human-readable string:
//   - non-finite or <= 0 bytes  -> "0 B"
//   - whole bytes (< 1024)      -> integer + " B", never a decimal
//   - larger units (KB/MB/GB/TB)-> value rounded to one decimal place, but
//     whole values render without a trailing ".0" (Math.round(x*10)/10)
//   - steps by 1024 per unit, capped at TB

import { describe, it, expect } from 'vitest'
import { humanSize } from './fileType.js'

describe('humanSize', () => {
  it('returns "0 B" for zero', () => {
    expect(humanSize(0)).toBe('0 B')
  })

  it('returns "0 B" for negative values', () => {
    expect(humanSize(-1)).toBe('0 B')
    expect(humanSize(-1024)).toBe('0 B')
  })

  it('returns "0 B" for non-finite values', () => {
    expect(humanSize(NaN)).toBe('0 B')
    expect(humanSize(Infinity)).toBe('0 B')
    expect(humanSize(-Infinity)).toBe('0 B')
  })

  it('returns "0 B" for non-numeric input', () => {
    expect(humanSize('not a number')).toBe('0 B')
    expect(humanSize(undefined)).toBe('0 B')
    expect(humanSize(null)).toBe('0 B')
  })

  describe('bytes (no decimal)', () => {
    it('formats a single byte', () => {
      expect(humanSize(1)).toBe('1 B')
    })

    it('formats a mid-range byte value', () => {
      expect(humanSize(512)).toBe('512 B')
    })

    it('formats the last whole-byte value below 1 KB', () => {
      expect(humanSize(1023)).toBe('1023 B')
    })
  })

  describe('kilobytes', () => {
    it('formats exactly 1024 bytes as "1 KB" (no trailing decimal)', () => {
      expect(humanSize(1024)).toBe('1 KB')
    })

    it('formats 1536 bytes as "1.5 KB"', () => {
      expect(humanSize(1536)).toBe('1.5 KB')
    })

    it('formats the last value below 1 MB in KB', () => {
      // 1048575 / 1024 = 1023.999... -> rounded to one decimal = 1024
      expect(humanSize(1048575)).toBe('1024 KB')
    })
  })

  describe('megabytes', () => {
    it('formats exactly 1 MB as "1 MB" (no trailing decimal)', () => {
      expect(humanSize(1048576)).toBe('1 MB')
    })

    it('formats 1.5 MB as "1.5 MB"', () => {
      expect(humanSize(1572864)).toBe('1.5 MB')
    })

    it('rounds to a single decimal place', () => {
      // 2411724 / 1024 / 1024 = 2.299... -> "2.3 MB"
      expect(humanSize(2411724)).toBe('2.3 MB')
    })
  })

  describe('gigabytes and terabytes', () => {
    it('formats exactly 1 GB as "1 GB"', () => {
      expect(humanSize(1024 ** 3)).toBe('1 GB')
    })

    it('formats exactly 1 TB as "1 TB"', () => {
      expect(humanSize(1024 ** 4)).toBe('1 TB')
    })

    it('caps at TB for values beyond a terabyte', () => {
      // 5 TB stays in TB (largest unit); no PB step.
      expect(humanSize(5 * 1024 ** 4)).toBe('5 TB')
    })
  })
})
