  // ---------- rendering ----------
  function renderChatList(){
    const list = $("chatList");
    list.innerHTML = "";
    
    // Group conversations by folder
    const groups = {};
    folders.forEach(f => { groups[f.id] = { folder: f, chats: [] }; });
    
    conversations.forEach(c => {
      if (!groups[c.folderId]) c.folderId = "general";
      groups[c.folderId].chats.push(c);
    });

    folders.forEach(f => {
      const g = groups[f.id];
      const folderDiv = document.createElement("div");
      folderDiv.className = "folder-group";
      
      const headerDiv = document.createElement("div");
      headerDiv.className = "folder-header" + (f.id === activeFolderId ? " active-folder" : "");
      headerDiv.innerHTML = `
        <span><span class="folder-arrow">▼</span> ${f.id === 'general' ? '💬' : '📁'} ${escapeHtml(f.name)}</span>
        ${f.id !== 'general' ? '<span class="del-folder" data-id="'+f.id+'">✕</span>' : ''}
      `;
      headerDiv.addEventListener("click", (e) => {
        if (e.target.classList.contains("del-folder")) return;
        folderDiv.classList.toggle("collapsed");
        activeFolderId = f.id;
        document.querySelectorAll(".folder-header").forEach(el => el.classList.remove("active-folder"));
        headerDiv.classList.add("active-folder");
      });
      
      if (f.id !== 'general') {
        headerDiv.addEventListener("dblclick", async () => {
          const newName = await customPrompt("Rename folder:", f.name);
          if (newName && newName.trim()) {
            f.name = newName.trim();
            persistFolders();
            renderChatList();
          }
        });
      }
      
      folderDiv.appendChild(headerDiv);
      
      const chatsDiv = document.createElement("div");
      chatsDiv.className = "folder-chats";
      
      g.chats.forEach(c => {
        const div = document.createElement("div");
        div.className = "chat-item" + (c.id === activeId ? " active" : "");
        div.innerHTML = escapeHtml(c.title) + '<span class="del" data-id="'+c.id+'">✕</span>';
        div.addEventListener("click", (e) => {
          if (e.target.classList.contains("del")) return;
          activeId = c.id;
          activeFolderId = c.folderId;
          renderChatList();
          renderMessages();
          renderActiveChatUI();
        });
        chatsDiv.appendChild(div);
      });
      
      folderDiv.appendChild(chatsDiv);
      list.appendChild(folderDiv);
    });

    list.querySelectorAll(".del-folder").forEach(el => {
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        const id = el.getAttribute("data-id");
        if(confirm("Delete this folder? Its chats will be moved to General.")){
           folders = folders.filter(f => f.id !== id);
           conversations.forEach(c => { 
             if(c.folderId === id) {
               c.folderId = 'general';
               if (window.electronAPI) window.electronAPI.saveChat(c);
             }
           });
           if(activeFolderId === id) activeFolderId = 'general';
           persistFolders();
           if (!window.electronAPI) persist();
           renderChatList();
        }
      });
    });

    list.querySelectorAll(".del").forEach(el => {
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        const id = el.getAttribute("data-id");
        conversations = conversations.filter(c => c.id !== id);
        localStorage.removeItem("signal_notes_" + id);
        if (window.electronAPI) window.electronAPI.deleteChat(id);
        if (activeId === id) activeId = conversations.length ? conversations[0].id : null;
        persist();
        renderChatList();
        renderMessages();
        renderActiveChatUI();
      });
    });
  }

  function escapeHtml(s){
    return String(s).replace(/[&<>"']/g, c => ({
      "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
    }[c]));
  }

  // very small markdown-ish renderer: fenced code blocks + inline code
  if (window.marked && window.hljs) {
    const renderer = new marked.Renderer();
    renderer.code = function(arg1, arg2, arg3) {
      let text, lang;
      if (typeof arg1 === 'object') {
        text = arg1.text;
        lang = arg1.lang;
      } else {
        text = arg1;
        lang = arg2;
      }
      const validLang = (lang && hljs.getLanguage(lang)) ? lang : 'plaintext';
      const highlighted = hljs.highlight(text, { language: validLang }).value;
      const encodedCode = escapeHtml(text);
      return '<div class="code-block-wrapper">' +
        '<button class="copy-btn" onclick="copyCode(this)" data-code="' + encodedCode + '">Copy</button>' +
        '<pre><code class="hljs ' + validLang + '">' + highlighted + '</code></pre>' +
      '</div>';
    };
    marked.use({ renderer });
  }

  window.copyCode = function(btn) {
    const code = btn.getAttribute("data-code") || "";
    const textarea = document.createElement("textarea");
    textarea.innerHTML = code;
    navigator.clipboard.writeText(textarea.value).then(() => {
      btn.textContent = "Copied!";
      setTimeout(() => btn.textContent = "Copy", 2000);
    }).catch(err => {
      console.error("Failed to copy", err);
    });
  };

  function renderContent(text){
    if (window.marked) {
      return marked.parse(text);
    }
    const parts = text.split(/```([\s\S]*?)```/g);
    let html = "";
    parts.forEach((part, i) => {
      if (i % 2 === 1){
        html += "<pre><code>" + escapeHtml(part.replace(/^\w*\n/, "")) + "</code></pre>";
      } else {
        let escaped = escapeHtml(part).replace(/`([^`]+)`/g, "<code>$1</code>");
        html += escaped;
      }
    });
    return html;
  }

  function renderMessages(){
    const container = $("messages");
    const conv = getActive();
    if (!conv || conv.messages.length === 0){
      container.innerHTML = "";
      container.appendChild($("emptyState").cloneNode(true) === null ? document.createElement("div") : buildEmptyState());
      $("chatTitle").textContent = conv ? conv.title : "untitled";
      return;
    }
    $("chatTitle").textContent = conv.title;
    container.innerHTML = "";
    conv.messages.forEach(m => {
      if (m.role === "tool") return; // tool results only shown in trace panel
      const row = document.createElement("div");
      row.className = "msg-row";
      const isUser = m.role === "user";
      let imagesHtml = "";
      if (m.images && m.images.length){
        imagesHtml = '<div class="msg-images">' +
          m.images.map((b64, i) => '<img src="data:' + ((m.imageMimes && m.imageMimes[i]) || "image/png") + ';base64,' + b64 + '">').join("") +
          '</div>';
      }
      row.innerHTML =
        '<div class="avatar ' + (isUser ? "user" : "assistant") + '">' + (isUser ? "you" : "λ") + '</div>' +
        '<div class="msg-body">' +
          '<div class="msg-role">' + (isUser ? "you" : "signal") + '</div>' +
          imagesHtml +
          '<div class="msg-text">' + renderContent(m.content || "") + '</div>' +
        '</div>';
      container.appendChild(row);
    });
    container.scrollTop = container.scrollHeight;
  }

  function buildEmptyState(){
    const div = document.createElement("div");
    div.className = "empty-state";
    div.innerHTML = $("emptyState").innerHTML;
    div.querySelectorAll(".hint-chip").forEach(chip => {
      chip.addEventListener("click", () => {
        $("input").value = chip.getAttribute("data-prompt");
        autoGrow();
        sendMessage();
      });
    });
    return div;
  }

  function addTraceEntry(toolName, argsStr, resultStr){
    traceCounter++;
    $("traceCount").textContent = traceCounter;
    const body = $("traceBody");
    const emptyMsg = body.querySelector(".trace-empty");
    if (emptyMsg) emptyMsg.remove();
    const entry = document.createElement("div");
    entry.className = "trace-entry";
    const time = new Date().toLocaleTimeString();
    entry.innerHTML =
      '<div class="num">' + String(traceCounter).padStart(2,"0") + '</div>' +
      '<div class="dot"></div>' +
      '<div class="tool-name">' + escapeHtml(toolName) + '(' + escapeHtml(argsStr) + ')</div>' +
      '<div class="tool-detail">→ ' + escapeHtml(resultStr) + '</div>' +
      '<div class="tool-time">' + time + '</div>';
    body.appendChild(entry);
    body.scrollTop = body.scrollHeight;
  }

  // ---------- files & images ----------
  let pendingDocuments = [];

  function fileToBase64(file){
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result; // data:<mime>;base64,<data>
        const commaIdx = result.indexOf(",");
        const meta = result.slice(5, result.indexOf(";")); // mime type
        const b64 = result.slice(commaIdx + 1);
        resolve({ b64, mime: meta || file.type || "image/png" });
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function addFiles(fileList){
    const files = Array.from(fileList || []);
    if (files.length === 0) return;
    
    for (const file of files){
      if (file.type.startsWith("image/")) {
        try {
          const { b64, mime } = await fileToBase64(file);
          pendingImages.push({ b64, mime });
        } catch(e){ /* skip */ }
      } else {
        const name = file.name.toLowerCase();
        const validDocExts = ['.pdf','.txt','.md','.py','.json','.js','.cpp','.c','.h','.hpp','.java','.html','.css','.rs','.go','.sh','.ts'];
        if (validDocExts.some(ext => name.endsWith(ext))) {
          // Document
          if (window.electronAPI) {
            const statusEl = document.createElement("div");
            statusEl.className = "image-thumb doc-thumb";
            statusEl.innerHTML = `<div class="doc-icon">📄</div><div class="doc-name">Processing ${file.name}...</div>`;
            $("imagePreviewStrip").appendChild(statusEl);

            try {
              const arrayBuffer = await file.arrayBuffer();
              const res = await window.electronAPI.processDocument(file.name, arrayBuffer);
              if (res.success) {
                pendingDocuments.push({ name: file.name, vectors: res.vectors });
              } else {
                alert("Failed to process document: " + res.error);
              }
            } catch(e) {
              alert("Error processing document: " + e.message);
            }
          } else {
            alert("Electron API not found. Please run this app via Electron.");
          }
        }
      }
    }
    renderFilePreviews();
  }

  function renderFilePreviews(){
    const strip = $("imagePreviewStrip");
    strip.innerHTML = "";
    
    pendingDocuments.forEach((doc, i) => {
      const thumb = document.createElement("div");
      thumb.className = "image-thumb doc-thumb";
      thumb.innerHTML =
        '<div class="doc-icon">📄</div>' +
        '<div class="doc-name">' + doc.name + ' (' + doc.vectors.length + ' chunks)</div>' +
        '<div class="remove" data-type="doc" data-i="' + i + '">✕</div>';
      strip.appendChild(thumb);
    });

    pendingImages.forEach((img, i) => {
      const thumb = document.createElement("div");
      thumb.className = "image-thumb";
      thumb.innerHTML =
        '<img src="data:' + img.mime + ';base64,' + img.b64 + '">' +
        '<div class="remove" data-i="' + i + '">✕</div>';
      strip.appendChild(thumb);
    });
    strip.querySelectorAll(".remove").forEach(el => {
      el.addEventListener("click", () => {
        const i = parseInt(el.getAttribute("data-i"), 10);
        const type = el.getAttribute("data-type");
        if (type === "doc") {
          pendingDocuments.splice(i, 1);
        } else {
          pendingImages.splice(i, 1);
        }
        renderFilePreviews();
      });
    });
  }

  function updateAttachHint(){
    const isVisionModel = /vl|vision|llava/i.test(config.model || "");
    $("attachBtn").classList.toggle("has-vl", isVisionModel);
    $("attachBtn").title = isVisionModel
      ? "attach an image — this model supports vision"
      : "attach an image (only works if the selected model supports vision, e.g. qwen2.5vl)";
  }

  // ---------- resizing ----------
  let isResizing = false;
  let currentHandle = null;

  const appEl = $("app");
  const handleLeft = $("resize-handle-left");
  const handleRight = $("resize-handle-right");

  if (handleLeft) {
    handleLeft.addEventListener("mousedown", (e) => {
      isResizing = true;
      currentHandle = 'left';
      handleLeft.classList.add("active");
      document.body.style.cursor = "col-resize";
    });
  }

  if (handleRight) {
    handleRight.addEventListener("mousedown", (e) => {
      isResizing = true;
      currentHandle = 'right';
      handleRight.classList.add("active");
      document.body.style.cursor = "col-resize";
    });
  }

  window.addEventListener("mousemove", (e) => {
    if (!isResizing) return;
    if (currentHandle === 'left') {
      const newWidth = Math.max(200, Math.min(e.clientX, 600));
      appEl.style.setProperty("--sidebar-width", newWidth + "px");
    } else if (currentHandle === 'right') {
      const newWidth = Math.max(200, Math.min(window.innerWidth - e.clientX, 800));
      appEl.style.setProperty("--trace-width", newWidth + "px");
    }
  });

  window.addEventListener("mouseup", () => {
    if (isResizing) {
      isResizing = false;
      if (handleLeft) handleLeft.classList.remove("active");
      if (handleRight) handleRight.classList.remove("active");
      document.body.style.cursor = "";
    }
  });
