import type { Metadata } from 'next';
import { SITE_NAME, SITE_URL } from '../../../lib/db';
import { AboutShell } from '../_layout';

export const metadata: Metadata = {
  title: `隐私政策 - ${SITE_NAME}`,
  description: '本站隐私政策',
  alternates: { canonical: `${SITE_URL}/about/privacy` },
};

export default function PrivacyPage() {
  return (
    <AboutShell active="privacy" title="隐私政策" updated="2026-05-08">
      <H2>1. 概述</H2>
      <P>本政策说明 {SITE_NAME} 在您访问本站时收集、使用和保护信息的方式。</P>

      <H2>2. 我们收集的信息</H2>
      <P>本站作为公开浏览的内容站点,默认不要求注册。在您正常浏览过程中,服务器仅记录维持服务运行所必需的信息:</P>
      <Ul>
        <li>访问日志:IP 地址、访问时间、User-Agent、Referer、所访问的 URL;</li>
        <li>Cookie:用于年龄确认状态、偏好设置等(具体见下方"Cookie 使用");</li>
        <li>分析数据:页面浏览量、停留时长等汇总统计(不与个人身份关联)。</li>
      </Ul>

      <H2>3. Cookie 使用</H2>
      <Ul>
        <li><b>age_ok</b>:用户年龄确认标记,有效期 1 年;</li>
        <li><b>第三方分析 cookie</b>:如启用 Google Analytics 等服务时由对应方写入,遵循各自隐私政策;</li>
        <li><b>第三方广告 cookie</b>:如启用广告平台时由对应方写入,可能涉及个性化推送。</li>
      </Ul>
      <P>您可以通过浏览器设置随时清除或拒绝 Cookie,但部分功能(如年龄确认)可能因此重复出现。</P>

      <H2>4. 信息共享</H2>
      <P>本站不主动出售或向第三方共享个人识别信息。但在以下情形可能涉及共享:</P>
      <Ul>
        <li>响应有管辖权的执法机构、法院的合法要求;</li>
        <li>与服务运行必需的第三方供应商(如 CDN、统计、广告平台)在最小必要范围内共享。</li>
      </Ul>

      <H2>5. 数据安全</H2>
      <P>本站采取合理的技术与管理措施保护服务器与数据,但不作绝对安全的承诺。</P>

      <H2>6. 联系方式</H2>
      <P>如对本政策有疑问,可通过 <a href="/about/dmca" style={{ color: '#a5b4fc' }}>版权与联系页面</a> 提供的方式与我们联系。</P>

      <P style={{ color: '#64748b', fontSize: 13, marginTop: 32 }}>※ 本文为占位文本,正式上线前请根据实际数据处理范围与法律要求(GDPR、PIPL、CCPA 等)由法律顾问审阅并替换。</P>
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
