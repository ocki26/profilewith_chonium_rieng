chrome.privacy.network.webRTCIPHandlingPolicy.set({
  value: "disable_non_proxied_udp",
});

chrome.webRequest.onBeforeRequest.addListener(
  function (details) {
    // Chặn các request WebRTC
    if (details.url.includes("stun:") || details.url.includes("turn:")) {
      return { cancel: true };
    }
  },
  { urls: ["<all_urls>"] },
  ["blocking"]
);
