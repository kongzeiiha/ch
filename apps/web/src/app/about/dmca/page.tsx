import type { Metadata } from 'next';
import { SITE_NAME, SITE_URL } from '../../../lib/db';
import { AboutShell } from '../_layout';

export const metadata: Metadata = {
  title: `版权投诉 - ${SITE_NAME}`,
  description: '版权侵权投诉与下架流程',
  alternates: { canonical: `${SITE_URL}/about/dmca` },
};

const CONTACT_EMAIL = process.env.DMCA_CONTACT_EMAIL ?? 'dmca@example.com';

export default function DmcaPage() {
  return (
    <AboutShell active="dmca" title="版权投诉(DMCA)" updated="2026-05-08">
      <P>{SITE_NAME} 尊重所有内容创作者的合法权利。如您是某条本站展示内容的著作权人,认为本站的展示侵犯了您的权利,可按以下流程提交下架请求,我们会在合理时间内处理。</P>

      <H2>1. 提交下架通知所需信息</H2>
      <P>请通过下方邮箱发送通知,包含:</P>
      <Ul>
        <li>权利人姓名、机构名称(如适用)、联系方式;</li>
        <li>声称被侵权作品的具体描述,以及您拥有该作品权利的证明(链接、登记号等);</li>
        <li>声称侵权内容在本站的具体位置(完整 URL,可附截图);</li>
        <li>本人善意相信使用方式未经许可的声明;</li>
        <li>所提供信息真实准确、且本人为权利人或其授权代表的声明;</li>
        <li>本人手写或电子签名。</li>
      </Ul>

      <H2>2. 联系方式</H2>
      <P>邮箱:<a href={`mailto:${CONTACT_EMAIL}`} style={{ color: '#a5b4fc' }}>{CONTACT_EMAIL}</a></P>
      <P>请将邮件主题命名为「DMCA 下架请求 - 您的姓名」,以便快速分流。</P>

      <H2>3. 处理时限</H2>
      <P>我们一般在收到完整通知后 <b>3-7 个工作日</b> 内回复并处理。在内部核实期间,可能先行下线相关页面以避免争议扩大。</P>

      <H2>4. 反通知</H2>
      <P>如您是被投诉内容的发布者或权利人,认为下架是误判,可发送反通知至上述邮箱。反通知应包含被下架内容的描述、本人为合法权利人的声明、联系方式与签名。</P>

      <H2>5. 滥用警告</H2>
      <P>请仅在您确实拥有相关权利时提交下架通知。提交虚假通知可能在某些司法辖区构成法律责任。</P>

      <P style={{ color: '#64748b', fontSize: 13, marginTop: 32 }}>※ 本文为占位文本,正式上线前请由法律顾问根据所在地法律(美国 DMCA、中国《信息网络传播权保护条例》、欧盟 DSA 等)审阅并替换。</P>
    </AboutShell>
  );
}

function H2({ children }: { children: React.ReactNode }) {
  return <h2 style={{ fontSize: 17, fontWeight: 700, color: '#e2e8f0', margin: '24px 0 8px' }}>{children}</h2>;
}
function P({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <p style={{ margin: '0 0 12px', ...style }}>{children}</p>;
}
function Ul({ children }: { children: React.ReactNode }) {
  return <ul style={{ paddingLeft: 22, margin: '0 0 12px', display: 'flex', flexDirection: 'column', gap: 4 }}>{children}</ul>;
}
