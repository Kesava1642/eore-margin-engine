/**
 * Resource route: GET /robots.txt
 * Returns 200 with text/plain to satisfy crawler requests and reduce 404 noise in logs (e.g. Railway).
 * Does not require auth; does not affect Shopify embedded app or app routes.
 *
 * Verification: curl -I https://app.eore.ai/robots.txt → 200, content-type: text/plain
 */
const ROBOTS_TXT = `User-agent: *
Disallow:
`;

export async function loader() {
  return new Response(ROBOTS_TXT, {
    status: 200,
    headers: {
      "Content-Type": "text/plain",
    },
  });
}
