'use strict';

const PII_PATTERNS = [
  // SSN: 3-2-4 grouped with separator (space or hyphen)
  // Avoids bare 9-digit strings — too many false positives (order numbers, zip+4, etc.)
  {
    pattern: /\b\d{3}[- ]\d{2}[- ]\d{4}\b/g,
    replacement: '[REDACTED-SSN]'
  },

  // Credit card: formatted 4-4-4-4 groups with separator
  {
    pattern: /\b(?:\d{4}[- ]){3}\d{4}\b/g,
    replacement: '[REDACTED-CC]'
  },

  // Credit card: unformatted, anchored to known BIN prefixes
  // Visa (16d), Mastercard (16d), Amex (15d), Discover (16d), JCB (15-16d)
  // BIN anchoring avoids false positives on generic long-digit strings
  {
    pattern: /\b(?:4\d{15}|5[1-5]\d{14}|3[47]\d{13}|6(?:011|5\d{2})\d{12}|(?:2131|1800|35\d{3})\d{11})\b/g,
    replacement: '[REDACTED-CC]'
  },

  // CVV: label required — bare 3-4 digit numbers are too common to scrub blindly
  {
    pattern: /\b(?:cvv2?|cvc|csc|security\s+code)[:\s]*\d{3,4}\b/gi,
    replacement: '[REDACTED-CVV]'
  },

  // Card expiry: MM/YY or MM/YYYY, valid month only (01-12)
  {
    pattern: /\b(?:0[1-9]|1[0-2])\/(?:\d{2}|\d{4})\b/g,
    replacement: '[REDACTED-EXPIRY]'
  },

  // ACH routing number: label required + exactly 9 digits
  {
    pattern: /\b(?:routing(?:\s+(?:number|transit(?:\s+number)?)?)?|aba(?:\s+number)?)[:\s]*\d{9}\b/gi,
    replacement: '[REDACTED-ROUTING]'
  },

  // Bank/ACH account number: label required + 6-17 digits
  {
    pattern: /\b(?:(?:bank\s+)?account(?:\s+number)?|(?:checking|savings)(?:\s+(?:account(?:\s+number)?|number))?)[:\s]*\d{6,17}\b/gi,
    replacement: '[REDACTED-ACCOUNT]'
  }
];

function scrubPii(text) {
  if (!text || typeof text !== 'string') return text;
  return PII_PATTERNS.reduce(
    (result, { pattern, replacement }) => result.replace(pattern, replacement),
    text
  );
}

module.exports = { scrubPii };
