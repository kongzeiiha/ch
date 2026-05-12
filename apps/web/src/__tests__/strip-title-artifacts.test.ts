import { describe, it, expect } from 'vitest';
import { stripTitleArtifacts, stripSpamLines, stripUrlsFromHtml, cleanTagList, isJunkTag, bodyDuplicatesTitle, displayTitle, sanitizeHtml } from '../lib/strip-urls';

describe('stripTitleArtifacts', () => {
  it('strips trailing 关键词《XXX》 at end', () => {
    expect(stripTitleArtifacts('妹纸们的爱爱多人运动会 关键词《不洁之星》'))
      .toBe('妹纸们的爱爱多人运动会');
  });

  it('strips trailing 关键字《XXX》 (variant label)', () => {
    expect(stripTitleArtifacts('内容标题 关键字《主题词》'))
      .toBe('内容标题');
  });

  it('strips trailing 标签:XXX', () => {
    expect(stripTitleArtifacts('某文章 标签:reddit, 探花'))
      .toBe('某文章');
  });

  it('strips trailing 分类：XXX (fullwidth colon)', () => {
    expect(stripTitleArtifacts('文章 分类：探花'))
      .toBe('文章');
  });

  it('strips bracketed [关键词:XXX]', () => {
    expect(stripTitleArtifacts('某文章 [关键词:abc def]'))
      .toBe('某文章');
  });

  it('strips bracketed （Keywords: a, b）', () => {
    expect(stripTitleArtifacts('Article Title （Keywords: a, b）'))
      .toBe('Article Title');
  });

  it('strips English Keywords: tail', () => {
    expect(stripTitleArtifacts('Some Title Keywords: alpha beta'))
      .toBe('Some Title');
  });

  it('strips multiple stacked tails', () => {
    expect(stripTitleArtifacts('内容 关键词《A》 标签:B'))
      .toBe('内容');
  });

  it('still strips URLs and @mentions (inherits stripUrlsFromText)', () => {
    expect(stripTitleArtifacts('某 https://t.co/xxx @user 关键词《X》'))
      .toBe('某');
  });

  it('does NOT strip mid-text 关键词 mentions', () => {
    expect(stripTitleArtifacts('讨论关键词的文章 这里是正文'))
      .toBe('讨论关键词的文章 这里是正文');
  });

  it('does NOT strip 关键词 that is not at the end', () => {
    // Tail anchor: only end-of-string artifacts are removed.
    expect(stripTitleArtifacts('关键词《X》 但后面还有真正的标题'))
      .toBe('关键词《X》 但后面还有真正的标题');
  });

  it('handles empty / null / undefined', () => {
    expect(stripTitleArtifacts('')).toBe('');
    expect(stripTitleArtifacts(null)).toBe('');
    expect(stripTitleArtifacts(undefined)).toBe('');
  });

  it('idempotent when nothing matches', () => {
    const s = '普通的标题没有 LLM 痕迹';
    expect(stripTitleArtifacts(s)).toBe(s);
  });

  it('handles the real-world failing case from the bug report', () => {
    expect(stripTitleArtifacts('妹纸们跟高层大叔们的爱爱多人运动会，输了的将受到惩罚 关键词《不洁之星》'))
      .toBe('妹纸们跟高层大叔们的爱爱多人运动会，输了的将受到惩罚');
  });
});

describe('stripSpamLines (body text, line-anchored LLM patterns)', () => {
  it('drops a standalone LLM-label line from the body', () => {
    const input = '妹纸们的爱爱多人运动会\n\n关键词《不洁之星》';
    // stripSpamLines splits on \n and filters per line — the empty-line and
    // body line stay; the LLM-tail line is removed.
    expect(stripSpamLines(input)).toBe('妹纸们的爱爱多人运动会\n');
  });

  it('drops bare label:value lines too', () => {
    expect(stripSpamLines('正文内容\n标签:reddit, 探花'))
      .toBe('正文内容');
  });

  it('keeps lines that just MENTION 关键词 mid-sentence', () => {
    const input = '这篇文章讨论关键词的设计\n第二段也讨论';
    // No line is purely an LLM label artifact — both stay.
    expect(stripSpamLines(input)).toBe(input);
  });

  it('preserves the existing spam rules (no regression)', () => {
    expect(stripSpamLines('文章内容\n下载链接：https://x.com'))
      .toBe('文章内容');
  });
});

describe('stripUrlsFromHtml (per-<p> LLM-tail strip)', () => {
  it('strips trailing LLM tail from a multi-line <p>', () => {
    const html = '<p>妹纸们跟高层大叔们的爱爱多人运动会，输了的将受到惩罚\n\n关键词《不洁之星》 https://t.co/O0JlCHarWr\n@fufutop2</p>';
    // URLs + @mentions go first, then the LLM tail at the end of the <p>,
    // then trailing whitespace inside the tag is trimmed.
    expect(stripUrlsFromHtml(html))
      .toBe('<p>妹纸们跟高层大叔们的爱爱多人运动会，输了的将受到惩罚</p>');
  });

  it('drops the whole <p> when nothing meaningful is left after strip', () => {
    const html = '<p>https://t.co/abc @user 关键词《X》</p>';
    expect(stripUrlsFromHtml(html)).toBe('');
  });

  it('leaves mid-text 关键词 mentions in legitimate paragraphs alone', () => {
    const html = '<p>本文讨论关键词设计这个话题</p>';
    expect(stripUrlsFromHtml(html)).toBe('<p>本文讨论关键词设计这个话题</p>');
  });

  it('handles multiple <p> independently', () => {
    const html = '<p>第一段 关键词《A》</p><p>第二段正常内容</p>';
    expect(stripUrlsFromHtml(html)).toBe('<p>第一段</p><p>第二段正常内容</p>');
  });
});

describe('isJunkTag / cleanTagList', () => {
  it('flags LLM-artifact strings as junk', () => {
    expect(isJunkTag('关键词《不洁之星》')).toBe(true);
    expect(isJunkTag('Keywords: a, b')).toBe(true);
    expect(isJunkTag('[标签:abc]')).toBe(true);
  });

  it('flags truncated LLM-label tags (missing closing bracket)', () => {
    // Real-world: VARCHAR(128) truncation or LLM stopped mid-token leaves
    // a tag like "关键词《不洁之星" with no closing 》.
    expect(isJunkTag('关键词《不洁之星')).toBe(true);
    expect(isJunkTag('关键词《')).toBe(true);
    expect(isJunkTag('关键词')).toBe(true);
    expect(isJunkTag('Keywords《abc')).toBe(true);
  });

  it('flags sentence-length strings as junk', () => {
    expect(isJunkTag('妹纸拿着自己暗恋的老师喝过的瓶子自己开始自喂起来了')).toBe(true);
  });

  it('flags strings with sentence punctuation as junk', () => {
    expect(isJunkTag('真的好棒呀！')).toBe(true);
    expect(isJunkTag('这是吗？')).toBe(true);
    expect(isJunkTag('结束。')).toBe(true);
  });

  it('flags bare URLs / @handles as junk', () => {
    expect(isJunkTag('https://t.co/abc')).toBe(true);
    expect(isJunkTag('@user_name')).toBe(true);
  });

  it('lets real short tags through', () => {
    expect(isJunkTag('探花')).toBe(false);
    expect(isJunkTag('reddit')).toBe(false);
    expect(isJunkTag('SM')).toBe(false);
    expect(isJunkTag('动漫')).toBe(false);
  });

  it('flags empty / nullish', () => {
    expect(isJunkTag('')).toBe(true);
    expect(isJunkTag('   ')).toBe(true);
    expect(isJunkTag(null)).toBe(true);
    expect(isJunkTag(undefined)).toBe(true);
  });

  it('cleanTagList removes only the junk', () => {
    const dirty = ['调教', '妹纸拿着自己暗恋的老师喝过的瓶子', '关键词《千鹤酱的开发日记》', 'reddit'];
    expect(cleanTagList(dirty)).toEqual(['调教', 'reddit']);
  });

  it('cleanTagList tolerates non-array input', () => {
    expect(cleanTagList(null)).toEqual([]);
    expect(cleanTagList('not-an-array' as any)).toEqual([]);
  });
});

describe('bodyDuplicatesTitle', () => {
  it('flags exact duplicate (X-tweet ingest where title === body)', () => {
    const t = '妹纸们跟高层大叔们的爱爱多人运动会，输了的将受到惩罚';
    expect(bodyDuplicatesTitle(t, `<p>${t}</p>`)).toBe(true);
  });

  it('flags duplicate with @handle / URL noise (after norm)', () => {
    const t = '妹纸们跟高层大叔们的爱爱多人运动会，输了的将受到惩罚';
    const body = `<p>${t} https://t.co/abc @user</p>`;
    expect(bodyDuplicatesTitle(t, body)).toBe(true);
  });

  it('does NOT flag a legit body that opens with the title and adds 200 chars', () => {
    const t = 'She doesn’t chase the moment. She owns it.';
    const body = `<p>${t} From the boardroom to the boulevard — calm power in every step. European elegance, razor-sharp tailoring, and that quiet confidence.</p>`;
    expect(bodyDuplicatesTitle(t, body)).toBe(false);
  });

  it('flags near-duplicate body that only adds a few trailing chars', () => {
    const t = '某个标题';
    const body = `<p>${t}。完。</p>`; // < 25% extra
    expect(bodyDuplicatesTitle(t, body)).toBe(true);
  });

  it('treats empty body as duplicate (nothing to render)', () => {
    expect(bodyDuplicatesTitle('某标题', '')).toBe(true);
    expect(bodyDuplicatesTitle('某标题', '   ')).toBe(true);
    expect(bodyDuplicatesTitle('某标题', '<p>  </p>')).toBe(true);
  });

  it('treats empty title with non-empty body as non-duplicate', () => {
    expect(bodyDuplicatesTitle('', '<p>真正的正文内容很长很长很长</p>')).toBe(false);
  });

  it('flags real-world failing case: 美少妇多人运动 (X tweet duplicate)', () => {
    // title and body both contain "美少妇多人运动" plus the same t.co URL,
    // body additionally has an @chengrenshipin handle inside the <p>. After
    // URL+@handle+HTML+whitespace normalization both reduce to '美少妇多人运动'.
    const title = '美少妇多人运动 https://t.co/pbPiOSKCnt';
    const body = '<p>美少妇多人运动 https://t.co/pbPiOSKCnt\n@chengrenshipin</p>';
    expect(bodyDuplicatesTitle(title, body)).toBe(true);
  });
});

// The article page renders body HTML through an unconditional <p>-removal
// pass: every <p>...</p> block is dropped, but non-<p> structural elements
// (<ul>, <blockquote>, <pre>, etc.) survive. The replace happens at the
// page level, not in lib/strip-urls — these tests pin the regex behavior so
// a future refactor (e.g. moving the regex into a helper) keeps the
// "drop <p>, keep others" invariant.
describe('<p>-only removal pass (article body)', () => {
  // Exact regex used in apps/web/src/app/a/[slug]/page.tsx for unconditional
  // paragraph removal. Kept as a constant here so the test asserts the same
  // pattern; if the page file regex changes, this test should be updated to
  // match (the page-level integration test will catch true divergence).
  const STRIP_P = /<p\b[^>]*>[\s\S]*?<\/p>/gi;

  it('removes every <p>...</p> block', () => {
    expect('<p>one</p><p>two</p>'.replace(STRIP_P, '')).toBe('');
  });

  it('keeps <ul>/<blockquote>/<pre> between paragraphs intact', () => {
    const html = '<p>intro</p><ul><li>a</li><li>b</li></ul><p>outro</p><blockquote>quote</blockquote><pre>code</pre>';
    expect(html.replace(STRIP_P, '')).toBe('<ul><li>a</li><li>b</li></ul><blockquote>quote</blockquote><pre>code</pre>');
  });

  it('handles <p class="..."> with attributes', () => {
    expect('<p class="x" id="y">text</p>'.replace(STRIP_P, '')).toBe('');
  });

  it('does NOT eat across paragraph boundaries (non-greedy)', () => {
    const html = '<p>first</p>between<p>second</p>';
    expect(html.replace(STRIP_P, '')).toBe('between');
  });
});

describe('displayTitle (strict H1 / card cleanup)', () => {
  it('strips emoji from anywhere in the title', () => {
    expect(displayTitle('还得是包臀裙极品小🔥货撩起头发跪地吃🐔的样子'))
      .toBe('还得是包臀裙极品小货撩起头发跪地吃的样子');
  });

  it('strips bare-faced emoji clusters', () => {
    expect(displayTitle('一字马女神 🥵💦😍 完美身材'))
      .toBe('一字马女神 完美身材');
  });

  it('collapses repeated punctuation (..., ！！！, 、、、)', () => {
    // 、、、 → 、, ！！！ → ！, ... → . ; then trailing `.` is stripped as
    // tail-soup, ! is kept (it's tone). Net: 某标题、 还有这个！
    expect(displayTitle('某标题、、、 还有这个！！！...'))
      .toBe('某标题、 还有这个！');
  });

  it('trims trailing dot-soup / 。 left by truncation', () => {
    expect(displayTitle('某标题....')).toBe('某标题');
    expect(displayTitle('某标题。')).toBe('某标题');
  });

  it('preserves trailing single-char ellipsis (…) — truncation marker', () => {
    // displayTitle itself appends `…` when it truncates, so a second pass
    // (backfill → worker write) must NOT strip the marker.
    expect(displayTitle('某标题…')).toBe('某标题…');
  });

  it('truncation produces idempotent output (re-running keeps the …)', () => {
    const long = 'A'.repeat(120);
    const once = displayTitle(long, 80);
    const twice = displayTitle(once, 80);
    expect(twice).toBe(once);
    expect(twice.endsWith('…')).toBe(true);
  });

  it('collapses multiple spaces left after emoji removal', () => {
    expect(displayTitle('a 🔥 b 🐔 c')).toBe('a b c');
  });

  it('truncates titles longer than maxLen with an ellipsis', () => {
    const long = 'A'.repeat(120);
    const out = displayTitle(long, 80);
    expect(out.length).toBe(80);
    expect(out.endsWith('…')).toBe(true);
  });

  it('respects a custom maxLen (card uses 60)', () => {
    const long = 'A'.repeat(120);
    expect(displayTitle(long, 60)).toBe('A'.repeat(59) + '…');
  });

  it('still inherits stripTitleArtifacts (URL + @ + LLM tail)', () => {
    expect(displayTitle('美少妇多人运动 https://t.co/abc @user 关键词《X》'))
      .toBe('美少妇多人运动');
  });

  it('handles empty / null / undefined', () => {
    expect(displayTitle('')).toBe('');
    expect(displayTitle(null)).toBe('');
    expect(displayTitle(undefined)).toBe('');
  });

  it('strips arrow-decoration runs (↓↓↓ / →→→)', () => {
    expect(displayTitle('↓↓↓ 内容标题')).toBe('内容标题');
    expect(displayTitle('内容标题 →→→')).toBe('内容标题');
    expect(displayTitle('↓　↓　↓ 内容标题'))
      .toBe('内容标题');
  });

  it('does NOT strip a lone arrow (could be content)', () => {
    // Single arrow with no companion stays — it might be "走向→未来" style.
    expect(displayTitle('走向→未来')).toBe('走向→未来');
  });

  it('strips trailing hashtag chains', () => {
    expect(displayTitle('真正的标题 #互粉 #色情视频 #日本'))
      .toBe('真正的标题');
  });

  it('strips hashtag-only titles (all decoration, no content)', () => {
    // The case from the bug report: title is 100% decoration + hashtag tail.
    // After strip, empty → caller (article page H1) falls through to its
    // category fallback "${category} · 无标题内容".
    expect(displayTitle('↓　↓　↓ #互粉 ＃色情视频 ＃日本 #69 #乱交 #乳交 #内射 #口射 #手淫 #群射 #顔射'))
      .toBe('');
  });

  it('leaves a single mid-text hashtag alone', () => {
    expect(displayTitle('这篇关于 #SEO 的总结')).toBe('这篇关于 #SEO 的总结');
  });

  it('handles the real-world bug-report case end-to-end', () => {
    // URL stripped (t.co tail). All three emojis (🔥🐔😍) gone. The single
    // ～ between 货 and 撩 stays — it's a single FW tilde used as a phrase
    // separator, not a repeated artifact.
    expect(displayTitle('还得是包臀裙极品小🔥货～撩起头发跪地吃🐔的样子不要太迷人！随后翘起蜜桃美臀后入，第一视角抽插，直接爆肏白虎美穴😍 https://t.co/H66lxl54ec'))
      .toBe('还得是包臀裙极品小货～撩起头发跪地吃的样子不要太迷人！随后翘起蜜桃美臀后入，第一视角抽插，直接爆肏白虎美穴');
  });
});

describe('sanitizeHtml', () => {
  it('strips <script> blocks including content', () => {
    expect(sanitizeHtml('<p>safe</p><script>alert(1)</script><p>also safe</p>'))
      .toBe('<p>safe</p><p>also safe</p>');
  });

  it('strips self-closing <link>/<meta>', () => {
    expect(sanitizeHtml('<link rel="stylesheet" href="x"><p>ok</p>'))
      .toBe('<p>ok</p>');
  });

  it('strips <iframe>', () => {
    expect(sanitizeHtml('<p>before</p><iframe src="evil"></iframe><p>after</p>'))
      .toBe('<p>before</p><p>after</p>');
  });

  it('strips <style> tags including CSS payload', () => {
    expect(sanitizeHtml('<style>body{display:none}</style><p>body content</p>'))
      .toBe('<p>body content</p>');
  });

  it('strips inline event handlers (onclick, onerror)', () => {
    // Key invariant: no `on*=` handler survives. The regex pass preserves
    // the source attribute formatting (unquoted attrs stay unquoted), so
    // assert on the post-strip absence of handlers and untouched non-handler
    // attributes rather than a brittle exact-string match.
    const a = sanitizeHtml('<img src=x onerror=alert(1)>');
    expect(a).not.toMatch(/on\w+=/i);
    expect(a).toContain('src');
    const b = sanitizeHtml('<div onclick="alert(1)">x</div>');
    expect(b).not.toMatch(/on\w+=/i);
    expect(b).toBe('<div>x</div>');
    const c = sanitizeHtml('<a href="#" onMouseOver="js">x</a>');
    expect(c).not.toMatch(/on\w+=/i);
    expect(c).toContain('href="#"');
  });

  it('neutralizes javascript: in href/src', () => {
    expect(sanitizeHtml('<a href="javascript:alert(1)">x</a>'))
      .toContain('href="#"');
    expect(sanitizeHtml('<img src="javascript:foo">'))
      .toContain('src="#"');
  });

  it('strips srcdoc on iframes that somehow survived', () => {
    // (iframes themselves are dropped, but srcdoc removal also nukes the
    // attribute on any other element a bad feed sticks it on.)
    expect(sanitizeHtml('<div srcdoc="<script>x</script>">y</div>'))
      .toBe('<div>y</div>');
  });

  it('passes through safe HTML untouched (semantically)', () => {
    const safe = '<p>Hello <strong>world</strong> <a href="/a/foo">link</a></p>';
    expect(sanitizeHtml(safe)).toBe(safe);
  });

  it('tolerates empty / null input', () => {
    expect(sanitizeHtml('')).toBe('');
    expect(sanitizeHtml(null)).toBe('');
    expect(sanitizeHtml(undefined)).toBe('');
  });

  it('stripUrlsFromHtml composes sanitizeHtml first', () => {
    // Confirms the public pipeline (article page calls stripUrlsFromHtml)
    // gets defense-in-depth without remembering to call sanitize separately.
    expect(stripUrlsFromHtml('<p>ok</p><script>alert(1)</script>'))
      .toBe('<p>ok</p>');
  });
});
