export interface PlaywrightCommand {
  name: string;
  signature: string;
  description: string;
  insertTemplate: string;
}

export const PLAYWRIGHT_COMMANDS: PlaywrightCommand[] = [
  {
    name: "goto",
    signature: 'goto "<url>"',
    description: "Navigate the browser to a URL. Use {{variable}} for dynamic URLs.",
    insertTemplate: 'goto "https://example.com"',
  },
  {
    name: "click",
    signature: 'click "<selector>"',
    description: "Click an element matching the CSS selector or locator.",
    insertTemplate: 'click "#submit-button"',
  },
  {
    name: "tryClick",
    signature: 'tryClick "<selector>"',
    description:
      "Try to click an element; skip silently if not found (useful for cookie banners).",
    insertTemplate: 'tryClick "[aria-label=Accept cookies]"',
  },
  {
    name: "fill",
    signature: 'fill "<selector>" with "<value>"',
    description:
      "Type text into an input field. Use {{variable}} in the value for dynamic data.",
    insertTemplate: 'fill "#email" with "{{email}}"',
  },
  {
    name: "press",
    signature: 'press "<selector>" key "<key>"',
    description: "Press a keyboard key on a focused element (e.g. Enter, Tab).",
    insertTemplate: 'press "#search" key "Enter"',
  },
  {
    name: "waitForSelector",
    signature: 'waitForSelector "<selector>"',
    description: "Wait until an element matching the selector appears on the page.",
    insertTemplate: 'waitForSelector ".results-loaded"',
  },
  {
    name: "waitForTimeout",
    signature: "waitForTimeout <ms>",
    description: "Pause execution for a fixed number of milliseconds.",
    insertTemplate: "waitForTimeout 2000",
  },
  {
    name: "waitForLoadState",
    signature: 'waitForLoadState "<state>"',
    description:
      "Wait for page load state: load, domcontentloaded, or networkidle.",
    insertTemplate: 'waitForLoadState "networkidle"',
  },
  {
    name: "screenshot",
    signature: 'screenshot "<name>"',
    description: "Capture a screenshot of the current page for evidence.",
    insertTemplate: 'screenshot "after-submit"',
  },
  {
    name: "assertContains",
    signature: 'assertContains "<text>"',
    description: "Assert that the page body contains the given text.",
    insertTemplate: 'assertContains "Application submitted"',
  },
  {
    name: "assertVisible",
    signature: 'assertVisible "<selector>"',
    description: "Assert that an element matching the selector is visible.",
    insertTemplate: 'assertVisible ".success-message"',
  },
  {
    name: "extractText",
    signature: 'extractText "<selector>" into <variable>',
    description:
      "Read text from an element and store it as an output variable for the next test case.",
    insertTemplate: 'extractText ".confirmation-id" into confirmationId',
  },
];

export function filterCommands(query: string): PlaywrightCommand[] {
  const q = query.toLowerCase();
  if (!q) return PLAYWRIGHT_COMMANDS;
  return PLAYWRIGHT_COMMANDS.filter(
    (c) =>
      c.name.toLowerCase().includes(q) ||
      c.description.toLowerCase().includes(q),
  );
}
