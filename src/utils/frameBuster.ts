if (window.top && window.top !== window.self) {
  (window.top.location as unknown) = window.self.location.href;
}
