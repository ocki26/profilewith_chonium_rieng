document.addEventListener("DOMContentLoaded", () => {
  // === DOM Elements ===
  const newProfileNameInput = document.getElementById("newProfileName");
  const newProfileProxySelect = document.getElementById(
    "newProfileProxySelect"
  );
  const createProfileBtn = document.getElementById("createProfileBtn");
  const createProfileMessage = document.getElementById("createProfileMessage");
  const profileList = document.getElementById("profileList");

  // Thêm biến cho ô input URL
  const urlToOpenInput = document.getElementById("urlToOpen");

  const proxyNameInput = document.getElementById("proxyName");
  // ... (các biến khác giữ nguyên)

  // === Functions ===
  // ... (các hàm khác giữ nguyên)

  // === Event Listeners ===
  // ... (các event listener khác giữ nguyên)

  // Sửa lại sự kiện click trong Profile List
  profileList.addEventListener("click", async (event) => {
    const target = event.target;
    const profileName = target.dataset.profileName;
    if (!profileName) return;

    if (target.classList.contains("open-browser-btn")) {
      target.textContent = "Đang mở...";
      target.disabled = true;

      // Lấy URL từ ô input
      let url = urlToOpenInput.value.trim();
      // Thêm http:// nếu người dùng quên
      if (url && !url.startsWith("http://") && !url.startsWith("https://")) {
        url = "https://" + url;
      }

      // Gửi cả profileName và url lên backend
      const result = await window.electronAPI.openBrowser(profileName, url);

      if (!result.success) {
        alert(`Lỗi khi mở trình duyệt: ${result.message}`);
      }
      target.textContent = "Mở";
      target.disabled = false;
    } else if (target.classList.contains("edit-config-btn")) {
      // ... (code sửa config giữ nguyên)
    } else if (target.classList.contains("delete-profile-btn")) {
      // ... (code xóa profile giữ nguyên)
    }
  });

  // ... (các event listener khác giữ nguyên)
});

// (CODE ĐẦY ĐỦ CỦA FILE RENDERER.JS ĐỂ BẠN DỄ COPY)
document.addEventListener("DOMContentLoaded", () => {
  const newProfileNameInput = document.getElementById("newProfileName");
  const newProfileProxySelect = document.getElementById(
    "newProfileProxySelect"
  );
  const createProfileBtn = document.getElementById("createProfileBtn");
  const createProfileMessage = document.getElementById("createProfileMessage");
  const profileList = document.getElementById("profileList");
  const urlToOpenInput = document.getElementById("urlToOpen");
  const proxyNameInput = document.getElementById("proxyName");
  const proxyServerInput = document.getElementById("proxyServer");
  const proxyUsernameInput = document.getElementById("proxyUsername");
  const proxyPasswordInput = document.getElementById("proxyPassword");
  const addUpdateProxyBtn = document.getElementById("addUpdateProxyBtn");
  const proxyMessage = document.getElementById("proxyMessage");
  const proxyList = document.getElementById("proxyList");
  const profileConfigModal = document.getElementById("profileConfigModal");
  const closeButton = document.querySelector(".close-button");
  const currentProfileNameSpan = document.getElementById("currentProfileName");
  const configProxyNameDropdown = document.getElementById("configProxyName");
  const saveProfileConfigBtn = document.getElementById("saveProfileConfigBtn");
  const configMessage = document.getElementById("configMessage");
  let editingProfileName = "";
  let editingProxyName = "";
  async function updateProfileList() {
    const profiles = await window.electronAPI.getProfiles();
    profileList.innerHTML = "";
    if (profiles.length === 0) {
      profileList.innerHTML = "<li>Chưa có profile nào.</li>";
      return;
    }
    profiles.forEach((profile) => {
      const li = document.createElement("li");
      li.innerHTML = `<span>${profile.name}</span> <div class="actions"> <button data-profile-name="${profile.name}" class="open-browser-btn">Mở</button> <button data-profile-name="${profile.name}" class="edit-config-btn">Sửa</button> <button data-profile-name="${profile.name}" class="delete-profile-btn">Xóa</button> </div>`;
      profileList.appendChild(li);
    });
  }
  async function updateProxyList() {
    const proxies = await window.electronAPI.getProxies();
    proxyList.innerHTML = "";
    if (proxies.length === 0) {
      proxyList.innerHTML = "<li>Chưa có proxy nào.</li>";
    } else {
      proxies.forEach((proxy) => {
        const li = document.createElement("li");
        li.innerHTML = `<span> <b>${proxy.name}</b> - ${
          proxy.server
        } <small>(TZ: ${
          proxy.timezoneId || "N/A"
        })</small> </span> <div class="actions"> <button data-profile-name="${
          proxy.name
        }" class="edit-proxy-btn">Sửa</button> <button data-profile-name="${
          proxy.name
        }" class="delete-proxy-btn">Xóa</button> </div>`;
        proxyList.appendChild(li);
      });
    }
    updateProxyDropdowns();
  }
  async function updateProxyDropdowns() {
    const proxies = await window.electronAPI.getProxies();
    const defaultOption = '<option value="">Không dùng Proxy</option>';
    configProxyNameDropdown.innerHTML = defaultOption;
    newProfileProxySelect.innerHTML = defaultOption;
    proxies.forEach((proxy) => {
      const optionHTML = `<option value="${proxy.name}">${proxy.name} - ${proxy.server}</option>`;
      configProxyNameDropdown.innerHTML += optionHTML;
      newProfileProxySelect.innerHTML += optionHTML;
    });
  }
  createProfileBtn.addEventListener("click", async () => {
    const profileName = newProfileNameInput.value.trim();
    const proxyName = newProfileProxySelect.value;
    if (!profileName) {
      createProfileMessage.textContent = "Vui lòng nhập tên profile.";
      createProfileMessage.style.color = "red";
      return;
    }
    const result = await window.electronAPI.createProfile({
      profileName,
      proxyName,
    });
    if (result.success) {
      createProfileMessage.textContent = result.message;
      createProfileMessage.style.color = "green";
      newProfileNameInput.value = "";
      newProfileProxySelect.value = "";
      updateProfileList();
    } else {
      createProfileMessage.textContent = result.message;
      createProfileMessage.style.color = "red";
    }
  });
  profileList.addEventListener("click", async (event) => {
    const target = event.target;
    const profileName = target.dataset.profileName;
    if (!profileName) return;
    if (target.classList.contains("open-browser-btn")) {
      target.textContent = "Đang mở...";
      target.disabled = true;
      let url = urlToOpenInput.value.trim();
      if (url && !url.startsWith("http://") && !url.startsWith("https://")) {
        url = "https://" + url;
      }
      const result = await window.electronAPI.openBrowser(profileName, url);
      if (!result.success) {
        alert(`Lỗi khi mở trình duyệt: ${result.message}`);
      }
      target.textContent = "Mở";
      target.disabled = false;
    } else if (target.classList.contains("edit-config-btn")) {
      editingProfileName = profileName;
      currentProfileNameSpan.textContent = profileName;
      const result = await window.electronAPI.getProfileConfig(profileName);
      if (result.success) {
        configProxyNameDropdown.value = result.config.proxyName || "";
        configMessage.textContent = "";
        profileConfigModal.style.display = "block";
      } else {
        alert(`Lỗi khi lấy cấu hình: ${result.message}`);
      }
    } else if (target.classList.contains("delete-profile-btn")) {
      if (confirm(`Bạn có chắc chắn muốn xóa profile '${profileName}'?`)) {
        const result = await window.electronAPI.deleteProfile(profileName);
        alert(result.message);
        if (result.success) {
          updateProfileList();
        }
      }
    }
  });
  closeButton.addEventListener("click", () => {
    profileConfigModal.style.display = "none";
  });
  window.addEventListener("click", (event) => {
    if (event.target === profileConfigModal) {
      profileConfigModal.style.display = "none";
    }
  });
  saveProfileConfigBtn.addEventListener("click", async () => {
    const updatedConfig = { proxyName: configProxyNameDropdown.value || null };
    const result = await window.electronAPI.updateProfileConfig(
      editingProfileName,
      updatedConfig
    );
    if (result.success) {
      configMessage.textContent = result.message;
      configMessage.style.color = "green";
      setTimeout(() => {
        profileConfigModal.style.display = "none";
      }, 1500);
    } else {
      configMessage.textContent = result.message;
      configMessage.style.color = "red";
    }
  });
  addUpdateProxyBtn.addEventListener("click", async () => {
    const name = proxyNameInput.value.trim();
    const server = proxyServerInput.value.trim();
    if (!name || !server) {
      proxyMessage.textContent = "Tên và Server proxy không được để trống.";
      proxyMessage.style.color = "red";
      return;
    }
    const proxyConfig = {
      name,
      server,
      username: proxyUsernameInput.value.trim(),
      password: proxyPasswordInput.value.trim(),
    };
    let result;
    if (editingProxyName && editingProxyName === name) {
      result = await window.electronAPI.updateProxy(
        editingProxyName,
        proxyConfig
      );
    } else {
      result = await window.electronAPI.addProxy(proxyConfig);
    }
    proxyMessage.textContent = result.message;
    proxyMessage.style.color = result.success ? "green" : "red";
    if (result.success) {
      proxyNameInput.value = "";
      proxyServerInput.value = "";
      proxyUsernameInput.value = "";
      proxyPasswordInput.value = "";
      editingProxyName = "";
      addUpdateProxyBtn.textContent = "Thêm Proxy";
      updateProxyList();
    }
  });
  proxyList.addEventListener("click", async (event) => {
    const target = event.target;
    const proxyName = target.dataset.proxyName;
    if (!proxyName) return;
    if (target.classList.contains("edit-proxy-btn")) {
      const proxies = await window.electronAPI.getProxies();
      const proxyToEdit = proxies.find((p) => p.name === proxyName);
      if (proxyToEdit) {
        proxyNameInput.value = proxyToEdit.name;
        proxyServerInput.value = proxyToEdit.server;
        proxyUsernameInput.value = proxyToEdit.username || "";
        proxyPasswordInput.value = proxyToEdit.password || "";
        editingProxyName = proxyToEdit.name;
        addUpdateProxyBtn.textContent = "Cập nhật Proxy";
        proxyMessage.textContent = "";
      }
    } else if (target.classList.contains("delete-proxy-btn")) {
      if (confirm(`Bạn có chắc chắn muốn xóa proxy '${proxyName}'?`)) {
        const result = await window.electronAPI.deleteProxy(proxyName);
        alert(result.message);
        if (result.success) {
          if (editingProxyName === proxyName) {
            proxyNameInput.value = "";
            proxyServerInput.value = "";
            proxyUsernameInput.value = "";
            proxyPasswordInput.value = "";
            editingProxyName = "";
            addUpdateProxyBtn.textContent = "Thêm Proxy";
          }
          updateProxyList();
        }
      }
    }
  });
  updateProfileList();
  updateProxyList();
});
