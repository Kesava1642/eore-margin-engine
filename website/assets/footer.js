(function () {
  "use strict";
  var base = (window.location.pathname || "").indexOf("/pages/") !== -1 ? "../" : "";
  var footer = document.getElementById("site-footer");
  if (!footer) return;
  footer.innerHTML =
    '<footer class="site-footer" role="contentinfo">' +
    '  <div class="container">' +
    '    <div class="footer-grid">' +
    "      <div>" +
    '        <p><strong>EORE</strong> — Operational Decision Systems</p>' +
    '        <p class="text-muted">System-guided decisions at scale.</p>' +
    "      </div>" +
    "      <div>" +
    '        <p><a href="' + base + 'pages/contact.html">Contact</a></p>' +
    '        <p><a href="' + base + 'pages/about.html">About</a></p>' +
    '        <p><a href="' + base + 'pages/services.html">Product / Services</a></p>' +
    "      </div>" +
    "      <div>" +
    '        <p><a href="' + base + 'pages/admin.html">Dashboard</a></p>' +
    '        <p><a href="' + base + 'pages/decision-log.html">Decision Log</a></p>' +
    "      </div>" +
    "    </div>" +
    '    <div class="footer-bottom">' +
    "      <p>&copy; " + new Date().getFullYear() + " EORE. All rights reserved.</p>" +
    "    </div>" +
    "  </div>" +
    "</footer>";
})();
