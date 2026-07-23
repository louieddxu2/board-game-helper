(async () => {
  if ('serviceWorker' in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
  }
  if ('caches' in window) {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));
  }
  window.location.replace('/?pwa-reset=done');
})().catch(() => {
  document.querySelector('h1').textContent = '更新失敗';
  document.querySelector('p').textContent = '請關閉此頁後，再重新開啟一次。';
});
