if (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true) {
  document.documentElement.setAttribute('data-standalone', 'true');
}
