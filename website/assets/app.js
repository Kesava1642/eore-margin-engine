(function () {
  "use strict";

  // Contact form: front-end only, prevent submit and show confirmation
  var form = document.getElementById("contact-form");
  if (form) {
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var name = (form.querySelector('[name="name"]') || {}).value;
      var msg = document.getElementById("form-message");
      if (msg) {
        msg.textContent = "Thank you. Your message has been received. We will respond via the email you provided. Pilot requests will be followed up by email.";
        msg.setAttribute("role", "status");
      }
      form.reset();
    });
  }
})();
