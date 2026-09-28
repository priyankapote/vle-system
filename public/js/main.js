async function init() {
  try {
    ME = await api("/auth/me");
    await loadRefData();
  } catch (e) {
    return; // api() already redirects to the login page on 401
  }
  Auth.setUser(ME.user);
  Auth.setCustomer(ME.customer);
  window.applyBrand && window.applyBrand(SETTINGS.business_name);
  renderSidebar();
  document.getElementById("logout-btn").addEventListener("click", () => {
    Auth.clear();
    window.location.href = "/";
  });
  window.addEventListener("hashchange", route);
  route();
  startLiveUpdates();
}
init();
