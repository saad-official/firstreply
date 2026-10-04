/**
 * GET /embed.js: the embeddable snippet from the marketing page
 * (`<script src="https://<app>/embed.js" data-form="<form slug>" async></script>`).
 * Replaces the script tag with an iframe of the hosted form /f/<slug>?embed=1
 * that grows to fit. No cookies, no tracking; the slug is validated before use.
 */
const SCRIPT = String.raw`(function () {
  var s = document.currentScript;
  if (!s) return;
  var slug = (s.getAttribute("data-form") || "").toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/.test(slug)) return;
  var origin = new URL(s.src, window.location.href).origin;
  var f = document.createElement("iframe");
  f.src = origin + "/f/" + slug + "?embed=1";
  f.title = s.getAttribute("data-title") || "Contact form";
  f.loading = "lazy";
  f.style.cssText = "width:100%;min-height:640px;border:0;display:block;color-scheme:normal";
  s.parentNode.insertBefore(f, s);
})();`;

export function GET() {
  return new Response(SCRIPT, {
    headers: {
      "content-type": "text/javascript; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
}
