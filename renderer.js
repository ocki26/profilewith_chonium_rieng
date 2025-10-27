document.addEventListener("DOMContentLoaded", () => {
  const newProfileNameInput = document.getElementById("newProfileName");
  const createProfileBtn = document.getElementById("createProfileBtn");
  const createProfileMessage = document.getElementById("createProfileMessage");
  const profileList = document.getElementById("profileList");

  const profileConfigModal = document.getElementById("profileConfigModal");
  const closeButton = document.querySelector(".close-button");
  const currentProfileNameSpan = document.getElementById("currentProfileName");

  // Các trường nhập liệu cấu hình
  const configUserAgent = document.getElementById("configUserAgent");
  const configLocale = document.getElementById("configLocale");
  const configTimezoneId = document.getElementById("configTimezoneId");
  const configViewportWidth = document.getElementById("configViewportWidth");
  const configViewportHeight = document.getElementById("configViewportHeight");
  const configGeolocationLat = document.getElementById("configGeolocationLat");
  const configGeolocationLon = document.getElementById("configGeolocationLon");
  const configGeolocationAccuracy = document.getElementById(
    "configGeolocationAccuracy"
  );
  const configProxyServer = document.getElementById("configProxyServer");
  const configProxyUsername = document.getElementById("configProxyUsername");
  const configProxyPassword = document.getElementById("configProxyPassword");
  const configChromiumArgs = document.getElementById("configChromiumArgs");
  const configInitScripts = document.getElementById("configInitScripts");

  const saveProfileConfigBtn = document.getElementById("saveProfileConfigBtn");
  const configMessage = document.getElementById("configMessage");

  let editingProfileName = "";

  // ====================================================================
  // Chức năng UI
  // ====================================================================

  async function updateProfileList() {
    const profiles = await window.electronAPI.getProfiles();
    profileList.innerHTML = "";

    if (profiles.length === 0) {
      profileList.innerHTML = "<li>Chưa có profile nào.</li>";
      return;
    }

    profiles.forEach((profile) => {
      const li = document.createElement("li");
      li.innerHTML = `
                <span>${profile.name}</span>
                <button data-profile-name="${profile.name}" class="open-browser-btn">Mở Trình Duyệt</button>
                <button data-profile-name="${profile.name}" class="edit-config-btn">Sửa Cấu hình</button>
                <button data-profile-name="${profile.name}" class="delete-profile-btn">Xóa</button>
            `;
      profileList.appendChild(li);
    });
  }

  createProfileBtn.addEventListener("click", async () => {
    const profileName = newProfileNameInput.value.trim();
    if (!profileName) {
      createProfileMessage.textContent = "Vui lòng nhập tên profile.";
      createProfileMessage.style.color = "red";
      return;
    }

    const result = await window.electronAPI.createProfile(profileName);
    if (result.success) {
      createProfileMessage.textContent = result.message;
      createProfileMessage.style.color = "green";
      newProfileNameInput.value = "";
      updateProfileList();
    } else {
      createProfileMessage.textContent = result.message;
      createProfileMessage.style.color = "red";
    }
  });

  profileList.addEventListener("click", async (event) => {
    const target = event.target;
    const profileName = target.dataset.profileName;

    if (target.classList.contains("open-browser-btn")) {
      const result = await window.electronAPI.openBrowser(profileName);
      if (!result.success) {
        alert(`Lỗi khi mở trình duyệt: ${result.message}`);
      }
    } else if (target.classList.contains("edit-config-btn")) {
      editingProfileName = profileName;
      currentProfileNameSpan.textContent = profileName;
      const result = await window.electronAPI.getProfileConfig(profileName);
      if (result.success) {
        // Đổ dữ liệu từ config vào các trường input
        const config = result.config;
        configUserAgent.value = config.userAgent || "";
        configLocale.value = config.locale || "";
        configTimezoneId.value = config.timezoneId || "";

        configViewportWidth.value = config.viewport
          ? config.viewport.width
          : "";
        configViewportHeight.value = config.viewport
          ? config.viewport.height
          : "";

        configGeolocationLat.value = config.geolocation
          ? config.geolocation.latitude
          : "";
        configGeolocationLon.value = config.geolocation
          ? config.geolocation.longitude
          : "";
        configGeolocationAccuracy.value = config.geolocation
          ? config.geolocation.accuracy
          : "";

        configProxyServer.value = config.proxy ? config.proxy.server || "" : "";
        configProxyUsername.value = config.proxy
          ? config.proxy.username || ""
          : "";
        configProxyPassword.value = config.proxy
          ? config.proxy.password || ""
          : "";

        configChromiumArgs.value =
          config.chromiumArgs && Array.isArray(config.chromiumArgs)
            ? config.chromiumArgs.join("\n")
            : "";
        configInitScripts.value =
          config.initScripts && Array.isArray(config.initScripts)
            ? config.initScripts.join("\n")
            : "";

        configMessage.textContent = "";
        profileConfigModal.style.display = "block";
      } else {
        alert(`Lỗi khi lấy cấu hình: ${result.message}`);
      }
    } else if (target.classList.contains("delete-profile-btn")) {
      if (confirm(`Bạn có chắc chắn muốn xóa profile '${profileName}'?`)) {
        const result = await window.electronAPI.deleteProfile(profileName);
        if (result.success) {
          alert(result.message);
          updateProfileList();
        } else {
          alert(`Lỗi khi xóa profile: ${result.message}`);
        }
      }
    }
  });

  closeButton.addEventListener("click", () => {
    profileConfigModal.style.display = "none";
  });

  saveProfileConfigBtn.addEventListener("click", async () => {
    // Thu thập dữ liệu từ các trường input và tạo đối tượng config
    const updatedConfig = {
      userAgent: configUserAgent.value.trim() || undefined,
      locale: configLocale.value.trim() || undefined,
      timezoneId: configTimezoneId.value.trim() || undefined,
      viewport: {
        width: configViewportWidth.value
          ? parseInt(configViewportWidth.value)
          : undefined,
        height: configViewportHeight.value
          ? parseInt(configViewportHeight.value)
          : undefined,
      },
      geolocation: {
        latitude: configGeolocationLat.value
          ? parseFloat(configGeolocationLat.value)
          : undefined,
        longitude: configGeolocationLon.value
          ? parseFloat(configGeolocationLon.value)
          : undefined,
        accuracy: configGeolocationAccuracy.value
          ? parseInt(configGeolocationAccuracy.value)
          : undefined,
      },
      proxy:
        configProxyServer.value.trim() ||
        configProxyUsername.value.trim() ||
        configProxyPassword.value.trim()
          ? {
              server: configProxyServer.value.trim() || undefined,
              username: configProxyUsername.value.trim() || undefined,
              password: configProxyPassword.value.trim() || undefined,
            }
          : undefined,
      chromiumArgs: configChromiumArgs.value.trim()
        ? configChromiumArgs.value
            .split("\n")
            .map((arg) => arg.trim())
            .filter((arg) => arg)
        : undefined,
      initScripts: configInitScripts.value.trim()
        ? configInitScripts.value
            .split("\n")
            .map((script) => script.trim())
            .filter((script) => script)
        : undefined,
      acceptDownloads: true, // Giữ mặc định hoặc thêm input nếu muốn tùy chỉnh
    };

    // Loại bỏ các trường undefined hoặc null không cần thiết từ đối tượng config
    Object.keys(updatedConfig).forEach((key) => {
      if (updatedConfig[key] === undefined || updatedConfig[key] === null) {
        delete updatedConfig[key];
      } else if (
        typeof updatedConfig[key] === "object" &&
        !Array.isArray(updatedConfig[key])
      ) {
        // Xử lý các đối tượng con như viewport, geolocation, proxy
        let allUndefined = true;
        for (const subKey in updatedConfig[key]) {
          if (
            updatedConfig[key][subKey] !== undefined &&
            updatedConfig[key][subKey] !== null
          ) {
            allUndefined = false;
            break;
          }
        }
        if (allUndefined) {
          delete updatedConfig[key];
        }
      } else if (
        Array.isArray(updatedConfig[key]) &&
        updatedConfig[key].length === 0
      ) {
        delete updatedConfig[key];
      }
    });

    const result = await window.electronAPI.updateProfileConfig(
      editingProfileName,
      updatedConfig
    );
    if (result.success) {
      configMessage.textContent = result.message;
      configMessage.style.color = "green";
      setTimeout(() => {
        profileConfigModal.style.display = "none";
        configMessage.textContent = "";
      }, 1500);
    } else {
      configMessage.textContent = result.message;
      configMessage.style.color = "red";
    }
  });

  window.addEventListener("click", (event) => {
    if (event.target === profileConfigModal) {
      profileConfigModal.style.display = "none";
    }
  });

  updateProfileList();
});
