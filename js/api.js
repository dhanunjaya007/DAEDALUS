  // ---------- networking ----------
  async function checkConnection(){
    const dot = $("connDot");
    const text = $("connText");
    try {
      const res = await fetch(config.endpoint.replace(/\/$/, "") + "/api/tags", { method: "GET" });
      if (res.ok){
        dot.className = "status-dot ok";
        text.textContent = "ollama connected";
      } else {
        throw new Error("bad status");
      }
    } catch(e){
      dot.className = "status-dot bad";
      text.textContent = "ollama unreachable";
    }
  }

  async function populateModels(){
    const select = $("modelSelect");
    try {
      const res = await fetch(config.endpoint.replace(/\/$/, "") + "/api/tags", { method: "GET" });
      if (!res.ok) throw new Error("bad status");
      const data = await res.json();
      let names = (data.models || []).map(m => m.name);
      names = names.filter(n => !n.includes("embed"));
      
      if (config.model.includes("embed") && names.length > 0) {
        config.model = names[0];
        persistConfig();
      }

      select.innerHTML = "";
      if (names.length === 0){
        const opt = document.createElement("option");
        opt.value = config.model;
        opt.textContent = config.model + " (none pulled?)";
        select.appendChild(opt);
        return;
      }
      // make sure the currently configured model is present even if not in the list yet
      if (!names.includes(config.model)) names.unshift(config.model);
      names.forEach(name => {
        const opt = document.createElement("option");
        opt.value = name;
        opt.textContent = name;
        if (name === config.model) opt.selected = true;
        select.appendChild(opt);
      });
    } catch(e){
      select.innerHTML = "";
      const opt = document.createElement("option");
      opt.value = config.model;
      opt.textContent = config.model + " (offline)";
      select.appendChild(opt);
    }
  }

  // ---------- RAG Math ----------
  function dotProduct(vecA, vecB) {
    let dot = 0;
    for (let i = 0; i < vecA.length; i++) {
      dot += vecA[i] * vecB[i];
    }
    return dot;
  }
  function magnitude(vec) {
    let sum = 0;
    for (let i = 0; i < vec.length; i++) {
      sum += vec[i] * vec[i];
    }
    return Math.sqrt(sum);
  }
  function cosineSimilarity(vecA, vecB) {
    return dotProduct(vecA, vecB) / (magnitude(vecA) * magnitude(vecB));
  }

  async function embedString(text) {
    try {
      const res = await fetch(config.endpoint.replace(/\/$/, "") + "/api/embeddings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "nomic-embed-text", prompt: text })
      });
      const data = await res.json();
      return data.embedding;
    } catch(e) {
      console.error(e);
      return null;
    }
  }

  // ---------- Chat Flow ----------
  async function sendMessage(){
    const input = $("input");
    const text = input.value.trim();
    if (!text && pendingImages.length === 0 && pendingDocuments.length === 0) return;
    if (inFlight) return;

    let conv = getActive();
    if (!conv){
      newConversation();
      conv = getActive();
    }
    if (conv.messages.length === 0){
      conv.title = (text || "[attachment]").slice(0, 40) + (text.length > 40 ? "…" : "");
    }
    
    inFlight = true;
    $("sendBtn").disabled = true;

    let hiddenContext = "";
    
    // 1. YouTube Transcript Fetching
    const ytMatch = text.match(/(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/i);
    if (ytMatch && window.electronAPI) {
      $("sendBtn").textContent = "📺";
      try {
        const res = await window.electronAPI.fetchYouTubeTranscript(ytMatch[0]);
        if (res.success && res.text) {
          hiddenContext += `\n\n[YOUTUBE TRANSCRIPT FOR ${ytMatch[0]}]\n${res.text}\n[END TRANSCRIPT]\n`;
        } else {
          console.error("Failed to fetch transcript:", res.error);
        }
      } catch (err) {
        console.error(err);
      }
      $("sendBtn").textContent = "↑";
    }

    // 2. Document RAG
    if (pendingDocuments.length > 0 && text) {
      $("sendBtn").textContent = "…";
      const queryEmbedding = await embedString(text);
      if (queryEmbedding) {
        let allChunks = [];
        for (const doc of pendingDocuments) {
          for (const chunk of doc.vectors) {
            allChunks.push({
              text: chunk.text,
              score: cosineSimilarity(queryEmbedding, chunk.vector)
            });
          }
        }
        allChunks.sort((a, b) => b.score - a.score);
        const topChunks = allChunks.slice(0, 4).map(c => c.text);
        if (topChunks.length > 0) {
          hiddenContext = "Relevant context from uploaded documents:\n" + topChunks.join("\n\n") + "\n\n";
        }
      }
    }
    $("sendBtn").textContent = "↑";

    const userMsg = { role: "user", content: text, hiddenContext };
    if (pendingImages.length){
      userMsg.images = pendingImages.map(p => p.b64);
      userMsg.imageMimes = pendingImages.map(p => p.mime);
    }
    conv.messages.push(userMsg);
    persist();
    renderChatList();
    renderMessages();
    input.value = "";
    pendingImages = [];
    pendingDocuments = [];
    renderFilePreviews();
    autoGrow();

    await runChatTurn(conv);
  }

  async function runChatTurn(conv, depth){
    depth = depth || 0;
    inFlight = true;
    $("sendBtn").disabled = true;

    // placeholder assistant row while streaming
    const container = $("messages");
    const row = document.createElement("div");
    row.className = "msg-row";
    row.innerHTML =
      '<div class="avatar assistant">λ</div>' +
      '<div class="msg-body"><div class="msg-role">signal</div><div class="msg-text" id="streamTarget">…</div></div>';
    container.appendChild(row);
    container.scrollTop = container.scrollHeight;
    const target = row.querySelector("#streamTarget");

    const body = {
      model: config.model,
      messages: conv.messages.map(m => ({ 
        role: m.role, 
        content: m.hiddenContext ? (m.hiddenContext + "User Question:\n" + m.content) : m.content, 
        tool_calls: m.tool_calls, 
        tool_call_id: m.tool_call_id, 
        name: m.name, 
        images: m.images 
      })),
      stream: config.stream
    };
    const allPersonas = [...DEFAULT_PERSONAS, ...customPersonas];
    const activePersona = allPersonas.find(p => p.id === conv.personaId) || DEFAULT_PERSONAS[0];
    let sysPrompt = activePersona.prompt;
    
    if (memories.length > 0) {
      sysPrompt = `[MEMORY] Things you know about this user:\n${memories.map(m => "- " + m).join("\n")}\n[END MEMORY]\n\n` + sysPrompt;
    }
    if (conv.folderId && conv.folderId !== 'general' && folderKBs[conv.folderId]) {
      const folderName = folders.find(f => f.id === conv.folderId)?.name || "Folder";
      sysPrompt = `[FOLDER CONTEXT: "${folderName}"]\n${folderKBs[conv.folderId]}\n[END FOLDER CONTEXT]\n\n` + sysPrompt;
    }

    if (agentMode) {
      body.tools = TOOLS;
    }
    
    // Always inject system prompt if we have memories, KB, or agent mode
    if (agentMode || memories.length > 0 || (conv.folderId && folderKBs[conv.folderId])) {
      body.messages.unshift({
        role: "system",
        content: sysPrompt
      });
    }

    try {
      const res = await fetch(config.endpoint.replace(/\/$/, "") + "/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });

      if (!res.ok || !res.body){
        target.textContent = "error: could not reach the model (check settings / that Ollama is running).";
        finishTurn();
        return;
      }

      let fullContent = "";
      let toolCalls = null;

      if (config.stream){
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        while (true){
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop();
          for (const line of lines){
            if (!line.trim()) continue;
            let obj;
            try { obj = JSON.parse(line); } catch(e){ continue; }
            if (obj.message && obj.message.content){
              fullContent += obj.message.content;
              target.innerHTML = renderContent(fullContent) + '<span style="opacity:.4">▍</span>';
              container.scrollTop = container.scrollHeight;
            }
            if (obj.message && obj.message.tool_calls){
              toolCalls = obj.message.tool_calls;
            }
          }
        }
      } else {
        const data = await res.json();
        fullContent = (data.message && data.message.content) || "";
        toolCalls = data.message && data.message.tool_calls;
        target.innerHTML = renderContent(fullContent);
      }

      target.innerHTML = renderContent(fullContent);

      // Fallback for models that output tool calls as raw JSON in content
      if (!toolCalls || toolCalls.length === 0) {
        let cleanContent = fullContent.trim();
        if (cleanContent.startsWith('```json')) cleanContent = cleanContent.replace(/^```json/i, '').replace(/```$/, '').trim();
        else if (cleanContent.startsWith('```')) cleanContent = cleanContent.replace(/^```/, '').replace(/```$/, '').trim();
        
        if (cleanContent.startsWith('{') && cleanContent.includes('"name"')) {
          try {
            const parsed = JSON.parse(cleanContent);
            if (parsed.name) {
              toolCalls = [{ function: parsed, id: "call_" + Date.now() }];
            }
          } catch(e){}
        }
      }

      if (toolCalls && toolCalls.length){
        conv.messages.push({ role: "assistant", content: fullContent, tool_calls: toolCalls });
        row.remove(); // will be re-rendered as part of normal flow, tool results happen silently

        for (const call of toolCalls){
          const fn = call.function || {};
          let args = {};
          try { args = typeof fn.arguments === "string" ? JSON.parse(fn.arguments) : (fn.arguments || {}); } catch(e){ args = {}; }
          const result = await executeTool(fn.name, args, conv.id);
          addTraceEntry(fn.name, JSON.stringify(args), String(result));
          conv.messages.push({ role: "tool", name: fn.name, content: String(result), tool_call_id: call.id });
        }
        persist();
        finishTurn();
        if (depth < 2){
          await runChatTurn(conv, depth + 1);
        }
        return;
      }

      conv.messages.push({ role: "assistant", content: fullContent });
      persist();
      finishTurn();
      renderMessages();

      // Background tasks
      if (autoExtractMemories && fullContent) {
        extractMemoriesBackground(conv);
      }
      if (conv.folderId && conv.folderId !== 'general') {
        updateFolderKBBackground(conv);
      }
    } catch(e){
      target.textContent = "error: " + e.message;
      finishTurn();
    }
  }

  async function extractMemoriesBackground(conv) {
    if (conv.messages.length < 2) return;
    const lastUser = conv.messages.slice(-2).find(m => m.role === 'user');
    const lastAsst = conv.messages.slice(-1)[0];
    if (!lastUser || !lastAsst) return;

    const prompt = `Extract personal facts about the user (name, preferences, skills, tech stack, goals) from this exchange. Return ONLY a JSON array of strings containing new facts. If none, return []. Do not explain.
User: ${lastUser.content}
Assistant: ${lastAsst.content}`;

    try {
      const res = await fetch(config.endpoint.replace(/\/$/, "") + "/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: config.model,
          messages: [{ role: "user", content: prompt }],
          stream: false
        })
      });
      const data = await res.json();
      let content = data.message?.content?.trim() || "[]";
      if (content.startsWith("```json")) content = content.replace(/^```json/i, '').replace(/```$/, '').trim();
      else if (content.startsWith("```")) content = content.replace(/^```/, '').replace(/```$/, '').trim();
      const extracted = JSON.parse(content);
      if (Array.isArray(extracted) && extracted.length > 0) {
        let changed = false;
        extracted.forEach(m => {
          if (!memories.includes(m)) { memories.push(m); changed = true; }
        });
        if (changed) { persistMemories(); renderMemoryPanel(); }
      }
    } catch(e) { console.error("Memory extract error:", e); }
  }

  async function updateFolderKBBackground(conv) {
    if (conv.messages.length < 2) return;
    const lastUser = conv.messages.slice(-2).find(m => m.role === 'user');
    const lastAsst = conv.messages.slice(-1)[0];
    if (!lastUser || !lastAsst) return;
    
    let currentKB = folderKBs[conv.folderId] || "";
    const prompt = `Summarize the key information, decisions, code snippets, and facts from this new exchange. Be concise but complete.
User: ${lastUser.content}
Assistant: ${lastAsst.content}

Return ONLY the summary text, no conversational filler.`;

    try {
      const res = await fetch(config.endpoint.replace(/\/$/, "") + "/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: config.model,
          messages: [{ role: "user", content: prompt }],
          stream: false
        })
      });
      const data = await res.json();
      const summary = data.message?.content?.trim();
      if (summary) {
        currentKB += (currentKB ? "\n\n" : "") + `- ${summary}`;
        // compress if too long (>3000 chars)
        if (currentKB.length > 3000) {
           const compressRes = await fetch(config.endpoint.replace(/\/$/, "") + "/api/chat", {
             method: "POST",
             headers: { "Content-Type": "application/json" },
             body: JSON.stringify({
               model: config.model,
               messages: [{ role: "user", content: `Compress this knowledge base into a concise bulleted list of the most important facts. Keep code if essential.\n\n${currentKB}` }],
               stream: false
             })
           });
           const compressData = await compressRes.json();
           if (compressData.message?.content) {
             currentKB = compressData.message.content.trim();
           }
        }
        folderKBs[conv.folderId] = currentKB;
        persistKBs();
      }
    } catch(e) { console.error("Folder KB update error:", e); }
  }

  function finishTurn(){
    inFlight = false;
    $("sendBtn").disabled = false;
  }

  function autoGrow(){
    const el = $("input");
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  }
