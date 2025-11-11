// Block WebRTC hoàn toàn - chạy trước khi page load
(function () {
  "use strict";

  console.log("🛡️ WebRTC Blocker Extension loaded");

  // Xóa hoàn toàn WebRTC APIs
  const deleteWebRTC = () => {
    const objectsToDelete = [
      "RTCPeerConnection",
      "webkitRTCPeerConnection",
      "mozRTCPeerConnection",
      "RTCSessionDescription",
      "RTCIceCandidate",
      "RTCDataChannel",
      "RTCPeerConnectionIceEvent",
    ];

    objectsToDelete.forEach((obj) => {
      try {
        delete window[obj];
        Object.defineProperty(window, obj, {
          value: undefined,
          writable: false,
          configurable: false,
        });
      } catch (e) {}
    });

    // Vô hiệu hóa mediaDevices
    if (navigator.mediaDevices) {
      Object.defineProperty(navigator, "mediaDevices", {
        value: {
          getUserMedia: () => Promise.reject(new Error("WebRTC blocked")),
          enumerateDevices: () => Promise.resolve([]),
          getSupportedConstraints: () => ({}),
        },
        writable: false,
        configurable: false,
      });
    }

    // Override WebRTC functions
    const originalGetUserMedia = navigator.getUserMedia;
    navigator.getUserMedia = function () {
      return Promise.reject(new Error("WebRTC blocked by extension"));
    };
  };

  // Chạy ngay lập tức
  deleteWebRTC();

  // Chạy lại khi page load hoặc có sự thay đổi
  document.addEventListener("DOMContentLoaded", deleteWebRTC);
  window.addEventListener("load", deleteWebRTC);
})();
