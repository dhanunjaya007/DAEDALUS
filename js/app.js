  // ---------- wiring ----------
  function applyConfigToUI(){
    $("modelPill").textContent = config.model;
    $("endpointNote").textContent = config.endpoint;
    $("endpointInput").value = config.endpoint;
    $("modelInput").value = config.model;
    
    if (config.theme) {
      document.body.className = config.theme;
      $("themeSelect").value = config.theme;
    }
    if (config.systemPrompt !== undefined) {
      $("systemPromptInput").value = config.systemPrompt;
    }
    
    $("streamToggle").classList.toggle("on", !!config.stream);
    $("agentDefaultToggle").classList.toggle("on", !!config.agentDefault);
    agentMode = config.agentDefault;
    $("agentToggle").classList.toggle("on", agentMode);
  }

  $("newChatBtn").addEventListener("click", newConversation);

  $("newFolderBtn").addEventListener("click", async () => {
    const name = await customPrompt("New folder name:");
    if (name && name.trim()) {
      const folderId = "f-" + Date.now();
      folders.push({ id: folderId, name: name.trim() });
      activeFolderId = folderId;
      persistFolders();
      newConversation();
    }
  });

  function customPrompt(title, defaultValue = "") {
    return new Promise(resolve => {
      $("promptTitle").textContent = title;
      $("promptInput").value = defaultValue;
      $("promptOverlay").style.display = "flex";
      $("promptInput").focus();
      
      const submit = () => {
        cleanup();
        resolve($("promptInput").value);
      };
      const cancel = () => {
        cleanup();
        resolve(null);
      };
      
      const onKeydown = (e) => {
        if (e.key === "Enter") submit();
        if (e.key === "Escape") cancel();
      };
      
      $("promptSubmitBtn").onclick = submit;
      $("promptCancelBtn").onclick = cancel;
      $("promptInput").onkeydown = onKeydown;
      
      function cleanup() {
        $("promptOverlay").style.display = "none";
        $("promptSubmitBtn").onclick = null;
        $("promptCancelBtn").onclick = null;
        $("promptInput").onkeydown = null;
      }
    });
  }

  // Memory UI logic
  function renderMemoryPanel() {
    const list = $("memoryList");
    list.innerHTML = "";
    if (memories.length === 0) {
      list.innerHTML = '<div style="padding:4px; opacity:0.5;">No memories yet.</div>';
    } else {
      memories.forEach((mem, i) => {
        const div = document.createElement("div");
        div.className = "memory-item";
        div.innerHTML = `<span>• ${escapeHtml(mem)}</span><span class="del-mem" data-i="${i}">✕</span>`;
        list.appendChild(div);
      });
      list.querySelectorAll(".del-mem").forEach(el => {
        el.addEventListener("click", (e) => {
          const idx = parseInt(e.target.getAttribute("data-i"), 10);
          memories.splice(idx, 1);
          persistMemories();
          renderMemoryPanel();
        });
      });
    }
    $("autoMemoryToggle").classList.toggle("on", autoExtractMemories);
  }

  $("openMemory").addEventListener("click", () => {
    renderMemoryPanel();
    $("memoryOverlay").style.display = "flex";
  });
  $("closeMemoryBtn").addEventListener("click", () => {
    $("memoryOverlay").style.display = "none";
  });
  $("autoMemoryToggle").addEventListener("click", () => {
    autoExtractMemories = !autoExtractMemories;
    $("autoMemoryToggle").classList.toggle("on", autoExtractMemories);
    localStorage.setItem("signal_auto_memory", JSON.stringify(autoExtractMemories));
  });
  $("addMemoryBtn").addEventListener("click", () => {
    const v = $("newMemoryInput").value.trim();
    if (v) {
      if (!memories.includes(v)) {
        memories.push(v);
        persistMemories();
      }
      $("newMemoryInput").value = "";
      renderMemoryPanel();
    }
  });
  $("newMemoryInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") $("addMemoryBtn").click();
  });
  $("sendBtn").addEventListener("click", sendMessage);
  $("input").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey){
      e.preventDefault();
      sendMessage();
    }
  });
  $("input").addEventListener("input", autoGrow);

  $("toggleSidebar").addEventListener("click", () => {
    $("app").classList.toggle("sidebar-collapsed");
  });
  $("toggleTrace").addEventListener("click", () => {
    $("app").classList.toggle("trace-collapsed");
  });

  $("agentToggle").addEventListener("click", () => {
    agentMode = !agentMode;
    $("agentToggle").classList.toggle("on", agentMode);
  });

  $("exportBtn").addEventListener("click", async () => {
    if (!window.electronAPI) {
      alert("Export is only supported in the desktop app.");
      return;
    }
    const active = getActive();
    if (!active) return;
    
    let md = `# ${active.title}\n\n`;
    for (const msg of active.messages) {
      if (msg.role === 'tool') continue; // skip raw tool output in export
      md += `**${msg.role === 'user' ? 'You' : 'Signal'}**:\n${msg.content}\n\n---\n\n`;
    }
    
    try {
      const res = await window.electronAPI.exportChat(md);
      if (res.success) {
        // optionally show a quick notification
      } else if (res.error !== 'cancelled') {
        alert("Failed to export chat: " + res.error);
      }
    } catch(e) {
      alert("Error exporting chat: " + e.message);
    }
  });

  $("openSettings").addEventListener("click", () => {
    applyConfigToUI();
    $("settingsOverlay").classList.add("show");
  });
  $("cancelSettings").addEventListener("click", () => {
    applyConfigToUI();
    $("settingsOverlay").classList.remove("show");
  });
  $("themeSelect").addEventListener("change", () => {
    document.body.className = $("themeSelect").value;
  });
  $("streamToggle").addEventListener("click", () => $("streamToggle").classList.toggle("on"));
  $("agentDefaultToggle").addEventListener("click", () => $("agentDefaultToggle").classList.toggle("on"));
  
  // Persona UI Logic
  function renderActiveChatUI() {
    const conv = getActive();
    if (!conv) return;
    const allPersonas = [...DEFAULT_PERSONAS, ...customPersonas];
    const persona = allPersonas.find(p => p.id === conv.personaId) || DEFAULT_PERSONAS[0];
    $("activePersonaIcon").textContent = persona.icon || "🤖";
    $("activePersonaName").textContent = persona.name || "Default";
  }

  function renderPersonaWindow(query = "") {
    const list = $("personaList");
    list.innerHTML = "";
    const allPersonas = [...DEFAULT_PERSONAS, ...customPersonas];
    const lowerQ = query.toLowerCase();
    
    const filtered = allPersonas.filter(p => 
      p.name.toLowerCase().includes(lowerQ) || 
      (p.desc && p.desc.toLowerCase().includes(lowerQ))
    );
    
    if (filtered.length === 0) {
      list.innerHTML = '<div style="padding:12px; opacity:0.5;">No personas found.</div>';
      return;
    }
    
    const conv = getActive();
    const currentId = conv ? conv.personaId : "default";

    filtered.forEach(p => {
      const isCustom = !DEFAULT_PERSONAS.find(d => d.id === p.id);
      const isSelected = p.id === currentId;
      
      const div = document.createElement("div");
      div.className = `persona-item ${isSelected ? "selected" : ""}`;
      div.innerHTML = `
        <div class="persona-icon">${p.icon || "🤖"}</div>
        <div class="persona-info">
          <div class="persona-name">
            ${escapeHtml(p.name)}
            ${isCustom ? `<span class="persona-del" data-id="${p.id}">Delete</span>` : ""}
          </div>
          <div class="persona-desc">${escapeHtml(p.desc || "")}</div>
        </div>
      `;
      
      div.addEventListener("click", (e) => {
        if (e.target.classList.contains("persona-del")) {
          e.stopPropagation();
          const pId = e.target.getAttribute("data-id");
          if (confirm("Delete this custom persona?")) {
            customPersonas = customPersonas.filter(cp => cp.id !== pId);
            persistPersonas();
            // fallback if active was deleted
            if (currentId === pId && conv) {
              conv.personaId = "default";
              persist();
              renderActiveChatUI();
            }
            renderPersonaWindow(query);
          }
          return;
        }
        
        if (conv) {
          conv.personaId = p.id;
          persist();
          renderActiveChatUI();
        }
        $("personaSelectorOverlay").style.display = "none";
      });
      list.appendChild(div);
    });
  }

  $("openPersonaBtn").addEventListener("click", () => {
    $("personaSearch").value = "";
    renderPersonaWindow();
    $("personaSelectorOverlay").style.display = "flex";
    $("personaSearch").focus();
  });
  $("closePersonaSelectorBtn").addEventListener("click", () => $("personaSelectorOverlay").style.display = "none");
  $("personaSearch").addEventListener("input", (e) => renderPersonaWindow(e.target.value));
  
  $("openPersonaCreatorBtn").addEventListener("click", () => {
    $("personaSelectorOverlay").style.display = "none";
    $("newPersonaName").value = "";
    $("newPersonaIcon").value = "";
    $("newPersonaDesc").value = "";
    $("newPersonaPrompt").value = "";
    $("personaCreatorOverlay").style.display = "flex";
  });
  $("cancelPersonaCreateBtn").addEventListener("click", () => {
    $("personaCreatorOverlay").style.display = "none";
    $("personaSelectorOverlay").style.display = "flex";
  });
  $("savePersonaBtn").addEventListener("click", () => {
    const name = $("newPersonaName").value.trim();
    const prompt = $("newPersonaPrompt").value.trim();
    if (!name || !prompt) {
      alert("Name and System Prompt are required.");
      return;
    }
    const newP = {
      id: "cp-" + Date.now(),
      name,
      icon: $("newPersonaIcon").value.trim() || "👤",
      desc: $("newPersonaDesc").value.trim(),
      prompt
    };
    customPersonas.push(newP);
    persistPersonas();
    
    // Select it immediately
    const conv = getActive();
    if (conv) {
      conv.personaId = newP.id;
      persist();
      renderActiveChatUI();
    }
    
    $("personaCreatorOverlay").style.display = "none";
  });

  $("saveSettings").addEventListener("click", () => {
    config.endpoint = $("endpointInput").value.trim() || "http://localhost:11434";
    config.model = $("modelInput").value.trim() || "qwen2.5:7b";
    config.stream = $("streamToggle").classList.contains("on");
    config.agentDefault = $("agentDefaultToggle").classList.contains("on");
    config.theme = $("themeSelect").value;
    config.systemPrompt = $("systemPromptInput").value;
    persistConfig();
    applyConfigToUI();
    $("settingsOverlay").classList.remove("show");
    checkConnection();
    populateModels();
    updateAttachHint();
  });

  $("modelSelect").addEventListener("change", () => {
    config.model = $("modelSelect").value;
    persistConfig();
    $("modelPill").textContent = config.model;
    $("modelInput").value = config.model;
    updateAttachHint();
  });
  $("refreshModels").addEventListener("click", populateModels);

  $("attachBtn").addEventListener("click", () => $("fileInput").click());
  $("youtubeBtn").addEventListener("click", async () => {
    const url = await customPrompt("Paste YouTube URL:");
    if (url && url.trim()) {
      const input = $("input");
      input.value = (input.value + " " + url).trim();
      autoGrow();
      input.focus();
    }
  });
  $("fileInput").addEventListener("change", (e) => {
    addFiles(e.target.files);
    e.target.value = ""; // allow picking the same file again later
  });

  const appElDrop = document.body;
  ["dragenter","dragover"].forEach(evt => {
    appElDrop.addEventListener(evt, (e) => {
      e.preventDefault();
      $("composer").classList.add("drag-over");
    });
  });
  ["dragleave","drop"].forEach(evt => {
    appElDrop.addEventListener(evt, (e) => {
      e.preventDefault();
      $("composer").classList.remove("drag-over");
    });
  });
  appElDrop.addEventListener("drop", (e) => {
    if (e.dataTransfer && e.dataTransfer.files) addFiles(e.dataTransfer.files);
  });

  $("input").addEventListener("paste", (e) => {
    const items = (e.clipboardData || window.clipboardData).items;
    const files = [];
    for (const item of items){
      if (item.type && (item.type.startsWith("image/") || item.type.startsWith("text/"))) {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
    if (files.length) addFiles(files);
  });

  document.querySelectorAll(".hint-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      $("input").value = chip.getAttribute("data-prompt");
      autoGrow();
      sendMessage();
    });
  });

  // ---------- keyboard shortcuts ----------
  window.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
      e.preventDefault();
      $("app").classList.toggle("sidebar-collapsed");
    }
    if (e.key === "/" && document.activeElement !== $("input") && document.activeElement.tagName !== "TEXTAREA" && document.activeElement.tagName !== "INPUT") {
      e.preventDefault();
      $("input").focus();
    }
  });

  $("clearChatsBtn").addEventListener("click", () => {
    if (confirm("Are you sure you want to delete all chats? This cannot be undone.")) {
      conversations.forEach(c => {
        localStorage.removeItem("signal_notes_" + c.id);
        if (window.electronAPI) window.electronAPI.deleteChat(c.id);
      });
      conversations = [];
      activeId = null;
      persist();
      renderChatList();
      renderMessages();
      newConversation();
    }
  });

  // ---------- init ----------
  async function initApp() {
    applyConfigToUI();
    updateAttachHint();
    
    if (window.electronAPI) {
      conversations = await window.electronAPI.loadChats();
      folders = await window.electronAPI.loadData("folders") || [{ id: "general", name: "General" }];
      memories = await window.electronAPI.loadData("memories") || [];
      folderKBs = await window.electronAPI.loadData("kbs") || {};
      customPersonas = await window.electronAPI.loadData("personas") || [];
      
      // Migrate old chats
      const oldLocal = JSON.parse(localStorage.getItem("signal_conversations") || "[]");
      if (oldLocal.length > 0) {
        for (const chat of oldLocal) {
          if (!conversations.find(c => c.id === chat.id)) {
            await window.electronAPI.saveChat(chat);
            conversations.push(chat);
          }
        }
        localStorage.removeItem("signal_conversations");
      }
      conversations.sort((a,b) => b.id.localeCompare(a.id));
    } else {
      conversations = JSON.parse(localStorage.getItem("signal_conversations") || "[]");
      folders = JSON.parse(localStorage.getItem("signal_folders") || '[{"id":"general","name":"General"}]');
      memories = JSON.parse(localStorage.getItem("signal_memories") || "[]");
      folderKBs = JSON.parse(localStorage.getItem("signal_kbs") || "{}");
      customPersonas = JSON.parse(localStorage.getItem("signal_personas") || "[]");
    }
    
    // Migrate old chats without folderId or personaId
    let migrated = false;
    conversations.forEach(c => {
      if (!c.folderId) { c.folderId = "general"; migrated = true; }
      if (!c.personaId) { c.personaId = "default"; migrated = true; }
      if (migrated && window.electronAPI) window.electronAPI.saveChat(c);
    });
    if (migrated && !window.electronAPI) persist();
    
    // migrate missing config logic inside initApp
    if (!conversations.find(c => c.id === activeId) && conversations.length > 0) {
  });
  $("fileInput").addEventListener("change", (e) => {
    addFiles(e.target.files);
    e.target.value = ""; // allow picking the same file again later
  });

  const appElDrop = document.body;
  ["dragenter","dragover"].forEach(evt => {
    appElDrop.addEventListener(evt, (e) => {
      e.preventDefault();
      $("composer").classList.add("drag-over");
    });
  });
  ["dragleave","drop"].forEach(evt => {
    appElDrop.addEventListener(evt, (e) => {
      e.preventDefault();
      $("composer").classList.remove("drag-over");
    });
  });
  appElDrop.addEventListener("drop", (e) => {
    if (e.dataTransfer && e.dataTransfer.files) addFiles(e.dataTransfer.files);
  });

  $("input").addEventListener("paste", (e) => {
    const items = (e.clipboardData || window.clipboardData).items;
    const files = [];
    for (const item of items){
      if (item.type && (item.type.startsWith("image/") || item.type.startsWith("text/"))) {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
    if (files.length) addFiles(files);
  });

  document.querySelectorAll(".hint-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      $("input").value = chip.getAttribute("data-prompt");
      autoGrow();
      sendMessage();
    });
  });

  // ---------- keyboard shortcuts ----------
  window.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
      e.preventDefault();
      $("app").classList.toggle("sidebar-collapsed");
    }
    if (e.key === "/" && document.activeElement !== $("input") && document.activeElement.tagName !== "TEXTAREA" && document.activeElement.tagName !== "INPUT") {
      e.preventDefault();
      $("input").focus();
    }
  });

  $("clearChatsBtn").addEventListener("click", () => {
    if (confirm("Are you sure you want to delete all chats? This cannot be undone.")) {
      conversations.forEach(c => {
        localStorage.removeItem("signal_notes_" + c.id);
        if (window.electronAPI) window.electronAPI.deleteChat(c.id);
      });
      conversations = [];
      activeId = null;
      persist();
      renderChatList();
      renderMessages();
      newConversation();
    }
  });

  // ---------- init ----------
  async function initApp() {
    applyConfigToUI();
    updateAttachHint();
    
    if (window.electronAPI) {
      conversations = await window.electronAPI.loadChats();
      folders = await window.electronAPI.loadData("folders") || [{ id: "general", name: "General" }];
      memories = await window.electronAPI.loadData("memories") || [];
      folderKBs = await window.electronAPI.loadData("kbs") || {};
      customPersonas = await window.electronAPI.loadData("personas") || [];
      
      // Migrate old chats
      const oldLocal = JSON.parse(localStorage.getItem("signal_conversations") || "[]");
      if (oldLocal.length > 0) {
        for (const chat of oldLocal) {
          if (!conversations.find(c => c.id === chat.id)) {
            await window.electronAPI.saveChat(chat);
            conversations.push(chat);
          }
        }
        localStorage.removeItem("signal_conversations");
      }
      conversations.sort((a,b) => b.id.localeCompare(a.id));
    } else {
      conversations = JSON.parse(localStorage.getItem("signal_conversations") || "[]");
      folders = JSON.parse(localStorage.getItem("signal_folders") || '[{"id":"general","name":"General"}]');
      memories = JSON.parse(localStorage.getItem("signal_memories") || "[]");
      folderKBs = JSON.parse(localStorage.getItem("signal_kbs") || "{}");
      customPersonas = JSON.parse(localStorage.getItem("signal_personas") || "[]");
    }
    
    // Migrate old chats without folderId or personaId
    let migrated = false;
    conversations.forEach(c => {
      if (!c.folderId) { c.folderId = "general"; migrated = true; }
      if (!c.personaId) { c.personaId = "default"; migrated = true; }
      if (migrated && window.electronAPI) window.electronAPI.saveChat(c);
    });
    if (migrated && !window.electronAPI) persist();
    
    // migrate missing config logic inside initApp
    if (!conversations.find(c => c.id === activeId) && conversations.length > 0) {
      activeId = conversations[0].id;
    } else if (conversations.length === 0) {
      newConversation();
    }
    renderChatList();
    renderMessages();
    renderActiveChatUI();
    renderMemoryPanel();
    checkConnection();
    populateModels();
    setInterval(checkConnection, 15000);
  }

  initApp();