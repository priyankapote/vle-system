// Shows the current business name (set by the admin) on every page.
(function () {
  let current = "Aditi Enterprises"; // default text in the HTML files
  window.applyBrand = function (name) {
    if (!name) return;
    document.querySelectorAll("[data-biz-name]").forEach((el) => (el.textContent = name));
    document.title = document.title.split(current).join(name);
    current = name;
    window.BUSINESS_NAME = name;
  };
  fetch("/api/settings/public")
    .then((r) => r.json())
    .then((s) => window.applyBrand(s.business_name))
    .catch(() => {})
    .finally(() => document.documentElement.classList.add("brand-ready"));
})();
