import type { Metadata } from 'next';
import { SITE_NAME, SITE_URL } from '../../../lib/db';
import { AboutShell } from '../_layout';

// AboutShell 套 XLayout → XRightRail 查 DB; build 静态预渲染时拿不到 MySQL/Redis。
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: `服务条款 - ${SITE_NAME}`,
  description: '本站服务条款',
  alternates: { canonical: `${SITE_URL}/about/terms` },
};

export default function TermsPage() {
  return (
    <AboutShell active="terms" title="服务条款" updated="2026-05-08">
      <H2>1. 接受条款</H2>
      <P>欢迎访问 {SITE_NAME}(以下简称"本站")。访问或使用本站,即表示您已阅读、理解并同意接受本服务条款的全部内容。如不同意,请立即停止访问。</P>

      <H2>2. 内容声明</H2>
      <P>本站为内容聚合平台,通过自动化流程从多个公开来源采集、整理并展示信息。所有文章的著作权归原作者或其合法权利人所有。本站仅提供来源指引、二次编辑摘要,以及面向阅读体验的展示形式。</P>

      <H2>3. 用户行为</H2>
      <P>使用本站时,您承诺:</P>
      <Ul>
        <li>不从事任何违反所在国家或地区法律法规的行为;</li>
        <li>不通过自动化手段(爬虫、脚本等)对本站施加不合理的访问压力;</li>
        <li>不试图破坏、篡改、绕过本站的安全或访问控制机制;</li>
        <li>不以任何形式将本站内容用于侵犯第三方权益的用途。</li>
      </Ul>

      <H2>4. 责任限制</H2>
      <P>本站对所提供信息的准确性、完整性、及时性不作任何明示或暗示的担保。因使用本站内容产生的任何直接或间接损失,由使用者自行承担。</P>

      <H2>5. 内容下架</H2>
      <P>如您是某条内容的权利人,认为本站展示侵犯了您的权利,可通过 <a href="/about/dmca" style={{ color: '#1d9bf0' }}>版权投诉</a> 流程通知我们,我们将在合理时间内处理。</P>

      <H2>6. 条款变更</H2>
      <P>本站保留随时修订本服务条款的权利。修订后的条款将于本页发布即生效,本页底部的"最近更新"日期会同步刷新。</P>

      <P style={{ color: '#536471', fontSize: 13, marginTop: 32 }}>※ 本文为占位文本,正式上线前请由法律顾问审阅并替换。</P>
    </AboutShell>
  );
}

function H2({ children }: { children: React.ReactNode }) {
  return <h2 style={{ fontSize: 17, fontWeight: 700, color: '#0f1419', margin: '24px 0 8px' }}>{children}</h2>;
}
function P({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <p style={{ margin: '0 0 12px', ...style }}>{children}</p>;
}
function Ul({ children }: { children: React.ReactNode }) {
  return <ul style={{ paddingLeft: 22, margin: '0 0 12px', display: 'flex', flexDirection: 'column', gap: 4 }}>{children}</ul>;
}
