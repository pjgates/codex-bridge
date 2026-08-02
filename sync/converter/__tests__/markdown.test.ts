import { describe, expect, it } from "vitest";
import { enrichDescription } from "../../../src/rulesets/sf2e/statblock/enrich.js";
import { markdownToHtml } from "../markdown.js";
import { sanitizeFoundryEnricherLabels, sanitizeFoundryHtml, sanitizeHtml } from "../../../src/rulesets/sf2e/statblock/sanitize.js";

describe("converter HTML sanitization", () => {
    it("preserves reviewed journal HTML and safe links", () => {
        const html = markdownToHtml('<div class="callout"><strong>Safe</strong> <a href="https://example.com" target="_blank">link</a></div>');

        expect(html).toContain('<div class="callout"><strong>Safe</strong>');
        expect(html).toContain('href="https://example.com"');
        expect(html).toContain('rel="noopener noreferrer"');
    });

    it("removes active journal content and unsafe attributes", () => {
        const html = markdownToHtml('<p onclick="alert(1)">Safe<script>alert(1)</script><a href="javascript:alert(1)">link</a></p><svg><script>alert(2)</script></svg><p>Still safe</p>');

        expect(html).toContain("<p>Safe<a>link</a></p>");
        expect(html).toContain("<p>Still safe</p>");
        expect(html).not.toContain("script");
        expect(html).not.toContain("onclick");
        expect(html).not.toContain("javascript:");
    });
    it("removes backslash network-path URLs", () => {
        const html = markdownToHtml('<a href="\\\\evil.example/path">link</a><img src="\\\\evil.example/image.png">');

        expect(html).toBe("<p><a>link</a><img></p>");
    });

    it("drops malformed dangerous nodes without a regex pre-pass", () => {
        expect(sanitizeHtml("<p>Safe<script>alert(1)")).toBe("<p>Safe</p>");
    });

    it("drops repeated dangerous siblings while preserving surrounding content", () => {
        const dangerousSiblings = "<script>dropped</script>".repeat(2_000);

        expect(sanitizeHtml(`${dangerousSiblings}<p>kept</p>${dangerousSiblings}`)).toBe("<p>kept</p>");
    });

    it("does not treat inherited object keys as allowlist members", () => {
        const html = sanitizeHtml('<a href="https://example.com" constructor="kept" target="constructor" rel="constructor noreferrer">link</a><constructor>visible<strong>kept</strong></constructor>');

        expect(html).toBe('<a href="https://example.com" rel="noreferrer">link</a>visible<strong>kept</strong>');
    });

    it("flattens malformed nested unknown wrappers while preserving reviewed descendants", () => {
        const wrappers = Array.from({ length: 200 }, (_, index) => `<unknown-${index}>`).join("");
        const reviewedDescendants = Array.from({ length: 200 }, () => "<span>kept</span>").join("");

        expect(sanitizeHtml(`${wrappers}before${reviewedDescendants}<script>dropped</script>after`)).toBe(`before${reviewedDescendants}after`);
    });

    it("scrubs encoded markup from Foundry enricher labels before the later innerHTML boundary", () => {
        const html = markdownToHtml("@Check[reflex|dc:10]{&lt;img src=x onerror=alert(1)&gt;} [[/r 1d6]]{&lt;script&gt;alert(2)&lt;/script&gt;}");

        expect(html).not.toContain("img");
        expect(html).not.toContain("script");
        expect(html).toContain("[[/r 1d6]]{alert(2)}");
    });

    it("scrubs labels behind entity-encoded Foundry syntax delimiters", () => {
        const html = markdownToHtml("&#64;Check&#91;reflex|dc:10&#93;&#123;&lt;img src=x onerror=alert(1)&gt;&#125;");

        expect(html).toBe("<p>@Check[reflex|dc:10]{}</p>");
    });

    it("scrubs the exact first-closing-bracket Check label payload and matching PF2e grammars", () => {
        const payload = "&lt;img src=x onerror=alert(1)&gt;";

        expect(markdownToHtml(`@Check[reflex|foo:[]{${payload}}]`)).toBe("<p>@Check[reflex|foo:[]{}]</p>");
        expect(markdownToHtml(`@Localize[PF2E.[]{${payload}}]`)).toBe("<p>@Localize[PF2E.[]{}]</p>");
        expect(markdownToHtml(`@Template[burst|foo:[]{${payload}}]`)).toBe("<p>@Template[burst|foo:[]{}]</p>");
    });

    it("scrubs labels for every runtime enricher grammar after ordinary HTML sanitization", () => {
        const payload = "&lt;img src=x onerror=alert(1)&gt;";
        const cases = [
            ["@Check[reflex|dc:10]", "@Check[reflex|dc:10]"],
            ["@Localize[PF2E.Example]", "@Localize[PF2E.Example]"],
            ["@Template[burst|distance:10]", "@Template[burst|distance:10]"],
            ["@Damage[1d6[fire]]", "@Damage[1d6[fire]]"],
            ["@UUID[Actor.abc123]", "@UUID[Actor.abc123]"],
            ["@Embed[Actor.abc123]", "@Embed[Actor.abc123]"],
            ["[[/act grapple]]", "[[/act grapple]]"],
            ["[[/r 1d6[fire]]]", "[[/r 1d6[fire]]]"],
        ];

        for (const [prefix, expected] of cases) {
            expect(sanitizeFoundryHtml(`${prefix}{${payload}}`)).toBe(`${expected}{}`);
        }
    });

    it("scrubs entity-decoded parameters for every supported runtime enricher grammar", () => {
        const payload = "&lt;img src=x onerror=alert(1)&gt;";
        const cases = [
            [`@Check[${payload}]`, "@Check[]"],
            [`@Localize[${payload}]`, "@Localize[]"],
            [`@Template[${payload}]`, "@Template[]"],
            [`@Damage[${payload}]`, "@Damage[]"],
            [`@UUID[${payload}]`, "@UUID[]"],
            [`@Embed[${payload}]`, "@Embed[]"],
            [`[[/act grapple note=${payload}]]`, "[[/act grapple note=]]"],
            [`[[/r ${payload}]]`, "[[/r ]]"],
            [`[[${payload}]]`, "[[]]"],
        ];

        for (const [input, expected] of cases) {
            expect(sanitizeFoundryHtml(input)).toBe(expected);
        }
    });

    it("preserves safe parameter text while stripping the exact fallback-label payload", () => {
        expect(sanitizeFoundryHtml("@Check[skill-&lt;strong&gt;trained&lt;/strong&gt;|dc:10]")).toBe(
            "@Check[skill-trained|dc:10]",
        );
        expect(markdownToHtml("@Check[&lt;img src=x onerror=alert(1)&gt;]")).toBe("<p>@Check[]</p>");
    });

    it("preserves legitimate nested parameter syntax for balanced runtime enrichers", () => {
        const nestedDamage = "@Damage[(1d6 + @actor.level)[persistent,fire]]{fire damage}";
        const nestedInlineRoll = "[[/r 1d6[fire]]]{fire damage}";

        expect(sanitizeFoundryHtml(`${nestedDamage} ${nestedInlineRoll}`)).toBe(`${nestedDamage} ${nestedInlineRoll}`);
    });

    it("preserves legitimate parameters and options for every supported runtime enricher grammar", () => {
        const valid = [
            "@Check[athletics|dc:20|name:Trip]",
            "@Localize[PF2E.Actions.Trip.Title]",
            "@Template[cone|distance:30|traits:fire]",
            "@Damage[(1d6 + @actor.level)[persistent,fire]|options:foo]",
            "@UUID[Compendium.pf2e.actions-srd.Item.abc]",
            '@Embed[Actor.abc caption="Safe caption"]',
            "[[/act grapple dc=20 statistic=athletics]]",
            "[[/r 1d6[fire]]]",
            '@Embed[Actor.abc caption="Safe &amp; sound"]',
        ].join(" ");

        expect(sanitizeFoundryHtml(valid)).toBe(valid);
    });

    it("scrubs encoded markup from flavored inline-roll labels", () => {
        const html = markdownToHtml("[[/r 1d6[fire]]]{&lt;img src=x onerror=alert(1)&gt;}");

        expect(html).toBe("<p>[[/r 1d6[fire]]]{}</p>");
    });

    it("scrubs encoded markup from enriched bestiary labels", () => {
        const html = enrichDescription("@Check[reflex|dc:10]{&lt;img src=x onerror=alert(1)&gt;}");

        expect(html).toBe("<p>@Check[reflex|dc:10]{}</p>");
    });

    it("scrubs encoded flavored inline-roll labels during bestiary enrichment", () => {
        const html = enrichDescription("[[/r 1d6[fire]]]{&lt;img src=x onerror=alert(1)&gt;}");

        expect(html).toBe("<p>[[/r 1d6[fire]]]{}</p>");
    });

    it("scrubs labels with literal opening braces and rejects excessive nested entity encoding", () => {
        expect(markdownToHtml("@Check[reflex|dc:10]{{&lt;img src=x onerror=alert(1)&gt;}")).not.toContain("img");
        let encoded = "&lt;img src=x onerror=alert(1)&gt;";
        for (let iteration = 0; iteration < 17; iteration += 1) encoded = encoded.replaceAll("&", "&amp;");
        expect(() => sanitizeFoundryEnricherLabels(`@Check[reflex|dc:10]{${encoded}}`)).toThrow("bounded HTML entity decoding depth");
    });

    it("sanitizes reviewed bestiary HTML after enrichment", () => {
        const html = enrichDescription('<strong class="safe">Safe</strong><img src=x onerror="alert(1)"><script>alert(1)</script>');

        expect(html).toContain('<strong class="safe">Safe</strong>');
        expect(html).toContain('<img src="x">');
        expect(html).not.toContain("onerror");
        expect(html).not.toContain("alert(1)");
    });
});
