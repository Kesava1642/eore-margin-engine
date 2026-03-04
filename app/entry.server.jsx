import { PassThrough } from "stream";
import { renderToPipeableStream } from "react-dom/server";
import { ServerRouter } from "react-router";
import { createReadableStreamFromReadable } from "@react-router/node";
import { isbot } from "isbot";
import { addDocumentResponseHeaders } from "./shopify.server";

export const streamTimeout = 5000;

// Allow app to be embedded in Shopify Admin iframe. We do not set X-Frame-Options so that
// the browser does not block embedding; we rely on CSP frame-ancestors to restrict which
// origins can embed the app (Shopify Admin and *.myshopify.com only).
const SHOPIFY_FRAME_ANCESTORS = "frame-ancestors https://admin.shopify.com https://*.myshopify.com";

function applyEmbeddingHeaders(responseHeaders) {
  responseHeaders.delete("X-Frame-Options");
  const existing = responseHeaders.get("Content-Security-Policy") || "";
  const withoutFrameAncestors = existing.replace(/frame-ancestors[^;]*;?/gi, "").trim();
  const csp = withoutFrameAncestors
    ? `${withoutFrameAncestors}; ${SHOPIFY_FRAME_ANCESTORS};`
    : `${SHOPIFY_FRAME_ANCESTORS};`;
  responseHeaders.set("Content-Security-Policy", csp);
}

export default async function handleRequest(
  request,
  responseStatusCode,
  responseHeaders,
  reactRouterContext,
) {
  addDocumentResponseHeaders(request, responseHeaders);
  applyEmbeddingHeaders(responseHeaders);
  const userAgent = request.headers.get("user-agent");
  const callbackName = isbot(userAgent ?? "") ? "onAllReady" : "onShellReady";

  return new Promise((resolve, reject) => {
    const { pipe, abort } = renderToPipeableStream(
      <ServerRouter context={reactRouterContext} url={request.url} />,
      {
        [callbackName]: () => {
          const body = new PassThrough();
          const stream = createReadableStreamFromReadable(body);

          responseHeaders.set("Content-Type", "text/html");
          resolve(
            new Response(stream, {
              headers: responseHeaders,
              status: responseStatusCode,
            }),
          );
          pipe(body);
        },
        onShellError(error) {
          reject(error);
        },
        onError(error) {
          responseStatusCode = 500;
          console.error(error);
        },
      },
    );

    // Automatically timeout the React renderer after 6 seconds, which ensures
    // React has enough time to flush down the rejected boundary contents
    setTimeout(abort, streamTimeout + 1000);
  });
}
