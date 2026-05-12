/**
 * Shim for a Next 15 build-time resolver quirk.
 *
 * Even in pure App Router projects the build's "Collecting page data" phase
 * sometimes asks the Pages Router for `_document` (used as a fallback when
 * Next probes for legacy lifecycle hooks). When the file isn't present the
 * resolver throws `PageNotFoundError: Cannot find module for page: /_document`
 * and the build aborts.
 *
 * This file does *nothing* at runtime — App Router has its own root layout
 * in app/layout.tsx and never invokes <Document>. It exists solely to make
 * the build-time module resolution happy.
 */
import { Html, Head, Main, NextScript } from 'next/document';

export default function Document() {
  return (
    <Html lang="zh">
      <Head />
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
