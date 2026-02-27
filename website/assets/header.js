(function () {
  "use strict";
  var base = (window.location.pathname || "").indexOf("/pages/") !== -1 ? "../" : "";
  var header = document.getElementById("site-header");
  if (!header) return;
  header.innerHTML =
    '<a href="#main-content" class="sr-only skip-link">Skip to main content</a>' +
    '<header class="site-header" role="banner">' +
    '  <div class="container">' +
    '    <p class="site-logo"><a href="' + base + 'index.html" aria-label="EORE Home">EORE</a></p>' +
    '    <nav class="main-nav" aria-label="Main navigation">' +
    "      <ul>" +
    '        <li><a href="' + base + 'index.html" data-nav="home">Home</a></li>' +
    '        <li><a href="' + base + 'pages/services.html" data-nav="services">Product / Services</a></li>' +
    '        <li><a href="' + base + 'pages/how-it-works.html" data-nav="how">How It Works</a></li>' +
    '        <li><a href="' + base + 'pages/use-cases.html" data-nav="cases">Use Cases</a></li>' +
    '        <li><a href="' + base + 'pages/about.html" data-nav="about">About</a></li>' +
    '        <li><a href="' + base + 'pages/contact.html" data-nav="contact">Contact</a></li>' +
    '        <li><a href="' + base + 'pages/admin.html" data-nav="admin">Dashboard</a></li>' +
    '        <li><a href="' + base + 'pages/decision-log.html" data-nav="log">Decision Log</a></li>' +
    "      </ul>" +
    "    </nav>" +
    "  </div>" +
    "</header>";
})();
