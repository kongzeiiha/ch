// Mounts a structured-data <script> with the given object serialized as JSON.
// Multiple instances on the same page are fine — Google merges them.
//
// SECURITY: JSON.stringify does NOT escape `</` inside string values, so a
// field containing the substring "</script>" (e.g. a malicious article title
// scraped from an untrusted RSS feed) would close this tag early and let the
// rest execute as HTML/JS. Replace the angle bracket so the browser can never
// see `</script>` mid-payload. Google's JSON-LD parser handles the escaped
// form fine, and `<` decodes back to `<` for any consumer that re-parses.
function safeStringify(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

export function JsonLd({ data }: { data: unknown }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: safeStringify(data) }}
    />
  );
}
