# Vendored Markdown parser

`lib/vendor/marked.esm.js` is Marked **15.0.12**, obtained from the official npm package `marked@15.0.12` on 2026-11-03. Source: <https://registry.npmjs.org/marked/-/marked-15.0.12.tgz>. Project: <https://github.com/markedjs/marked>.

The upstream MIT licence and attribution are preserved in `lib/vendor/marked-LICENSE.md`.

| File | SHA256 |
| --- | --- |
| `lib/vendor/marked.esm.js` | `29E25CDF1A06075C90E9885AF06DDD23FB22A5424ED23A61DDA986C73A8AF641` |
| `lib/vendor/marked-LICENSE.md` | `8E3A3F82F59A60958F56CA08F445647C32A4733DC7CA6C2C46F6EB898471AB9C` |

The parser runs only during export. The viewer downloads no parser, styles or syntax highlighter. Marked is not a sanitizer. `lib/safe-markdown.js` restricts generated links and images and escapes raw HTML; generated documents also include a restrictive content security policy. Tests exercise the actual generated output. This is not a claim of an independent security audit.
