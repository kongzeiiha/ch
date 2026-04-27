import axios from 'axios';

/**
 * Tell the Next.js site to drop its ISR cache for the given paths.
 * Fire-and-forget: publishing should succeed even if the web is down.
 */
export async function revalidatePaths(paths: string[]): Promise<void> {
  const base = process.env.WEB_URL ?? 'http://localhost:3000';
  const secret = process.env.REVALIDATE_SECRET ?? 'dev';
  try {
    await axios.post(
      `${base}/api/revalidate`,
      { paths },
      {
        headers: { 'x-revalidate-secret': secret },
        timeout: 5_000,
      },
    );
  } catch (e: any) {
    // Deliberately non-fatal.
    console.warn(`[publishing] revalidate failed: ${e?.message ?? e}`);
  }
}
