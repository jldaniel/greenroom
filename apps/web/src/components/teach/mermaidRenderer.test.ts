import { describe, expect, it } from "vitest";

import {
  MERMAID_INIT_CONFIG,
  MERMAID_SVG_SANITIZE_CONFIG,
  sanitizeMermaidSvg,
  type SvgSanitizer,
} from "./mermaidRenderer";

describe("MERMAID_INIT_CONFIG", () => {
  it("locks Mermaid into strict security mode without auto-start", () => {
    expect(MERMAID_INIT_CONFIG.securityLevel).toBe("strict");
    expect(MERMAID_INIT_CONFIG.startOnLoad).toBe(false);
  });

  it("disables HTML labels so foreignObject stripping never drops label text", () => {
    expect(MERMAID_INIT_CONFIG.htmlLabels).toBe(false);
  });
});

describe("MERMAID_SVG_SANITIZE_CONFIG", () => {
  it("restricts DOMPurify to the SVG profiles", () => {
    expect(MERMAID_SVG_SANITIZE_CONFIG.USE_PROFILES).toEqual({ svg: true, svgFilters: true });
  });

  it("forbids script, foreignObject, and embedding tags", () => {
    for (const tag of ["script", "foreignobject", "iframe", "object", "embed"]) {
      expect(MERMAID_SVG_SANITIZE_CONFIG.FORBID_TAGS).toContain(tag);
    }
  });

  it("forbids URL-bearing link attributes", () => {
    expect(MERMAID_SVG_SANITIZE_CONFIG.FORBID_ATTR).toContain("href");
    expect(MERMAID_SVG_SANITIZE_CONFIG.FORBID_ATTR).toContain("xlink:href");
  });
});

describe("sanitizeMermaidSvg", () => {
  it("sanitizes with the SVG sandbox config and returns the sanitizer output", () => {
    const calls: Array<{ dirty: string; config: unknown }> = [];
    const sanitizer: SvgSanitizer = {
      sanitize: (dirty, config) => {
        calls.push({ dirty, config });
        return "<svg><g /></svg>";
      },
    };

    const result = sanitizeMermaidSvg("<svg><script>alert(1)</script></svg>", sanitizer);

    expect(result).toBe("<svg><g /></svg>");
    expect(calls).toEqual([
      {
        dirty: "<svg><script>alert(1)</script></svg>",
        config: MERMAID_SVG_SANITIZE_CONFIG,
      },
    ]);
  });

  it("throws when sanitization strips the SVG root, forcing the source fallback", () => {
    const sanitizer: SvgSanitizer = { sanitize: () => "" };
    expect(() => sanitizeMermaidSvg("<script>alert(1)</script>", sanitizer)).toThrow(
      /no SVG element/u,
    );
  });
});
