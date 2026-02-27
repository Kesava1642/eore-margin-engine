(function () {
  "use strict";
  function setActiveNav() {
    var path = (window.location.pathname || window.location.href || "").replace(/\/$/, "");
    var page = "home";
    if (path.indexOf("services") !== -1) page = "services";
    else if (path.indexOf("how-it-works") !== -1) page = "how";
    else if (path.indexOf("use-cases") !== -1) page = "cases";
    else if (path.indexOf("about") !== -1) page = "about";
    else if (path.indexOf("contact") !== -1) page = "contact";
    else if (path.indexOf("admin") !== -1) page = "admin";
    else if (path.indexOf("decision-log") !== -1) page = "log";
    var links = document.querySelectorAll('.main-nav a[data-nav]');
    for (var i = 0; i < links.length; i++) {
      var link = links[i];
      if (link.getAttribute("data-nav") === page) {
        link.classList.add("active");
        link.setAttribute("aria-current", "page");
      } else {
        link.classList.remove("active");
        link.removeAttribute("aria-current");
      }
    }
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", setActiveNav);
  } else {
    setActiveNav();
  }
})();
