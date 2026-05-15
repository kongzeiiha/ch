type SlotName = 'header' | 'before-content' | 'mid-content' | 'sidebar' | 'footer';

// Reads raw HTML from env at render time. Set e.g.
//   AD_SLOT_HEADER='<script async src="..."></script><ins class="adsbygoogle" .../>'
// in production. When unset, renders nothing. Set AD_SLOT_PLACEHOLDERS=on to
// surface a labeled dashed box during layout work.
export function AdSlot({ name }: { name: SlotName }) {
  const html = process.env[`AD_SLOT_${name.replace(/-/g, '_').toUpperCase()}`];
  if (html) {
    return (
      <div data-ad-slot={name} dangerouslySetInnerHTML={{ __html: html }} />
    );
  }
  if (process.env.AD_SLOT_PLACEHOLDERS !== 'on') return null;
  return (
    <div data-ad-slot={name} style={{
      border: '1px dashed #cfd9de',
      borderRadius: 12,
      padding: '14px 16px',
      color: '#536471',
      fontSize: 12,
      textAlign: 'center',
      background: '#ffffff',
      letterSpacing: 0.5,
    }}>
      AD · {name}
    </div>
  );
}
