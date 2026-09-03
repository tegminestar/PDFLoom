/**
 * ua-parser-js 1.x ships no type declarations of its own, and
 * @types/ua-parser-js on npm is a stub for the older 0.7.x default-export
 * API (a mismatched shape) — so this covers just the named-export surface
 * analytics.ts actually uses.
 */
declare module "ua-parser-js" {
  interface UAParserResult {
    device: { type?: string; model?: string; vendor?: string };
    browser: { name?: string; version?: string };
    os: { name?: string; version?: string };
  }

  export class UAParser {
    constructor(uaString?: string);
    getResult(): UAParserResult;
  }
}
