// Mounts a structured-data <script> with the given object serialized as JSON.
// Multiple instances on the same page are fine — Google merges them.
export function JsonLd({ data }: { data: unknown }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}
