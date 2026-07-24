const $ = (id) => document.getElementById(id);
  let config = JSON.parse(localStorage.getItem("signal_config") || "null") || {
    endpoint: "http://localhost:11434",
    model: "qwen2.5:7b",
    stream: true,
    agentDefault: false,
    theme: "theme-dark",
    systemPrompt: "You are an AI assistant. If you are asked about news, current events, or real-time info, you MUST search the web. To use a tool, you MUST output ONLY the following JSON format and no other text:\n```json\n{\n  \"name\": \"search_web\",\n  \"arguments\": {\n    \"query\": \"<your search query>\"\n  }\n}\n```"
  };

  let conversations = [];
  let folders = [{ id: "general", name: "General" }];
  let activeFolderId = "general";
  let memories = [];
  let autoExtractMemories = JSON.parse(localStorage.getItem("signal_auto_memory") || "true");
  let folderKBs = {};
  
  const DEFAULT_PERSONAS = [
    { id: "default", name: "Default Assistant", icon: "🤖", desc: "Your standard, helpful AI companion.", prompt: "You are a helpful AI assistant." },
    { id: "socratic", name: "Socratic Tutor", icon: "🎓", desc: "Guides you to the answer with questions.", prompt: "You are a Socratic tutor. Do not give direct answers. Instead, ask guiding questions to help the user figure it out themselves." },
    { id: "writing", name: "Writing Assistant", icon: "📝", desc: "Edits essays and emails for structure and tone.", prompt: "You are an expert writing assistant. Focus on grammar, structure, tone, and conciseness. Provide constructive feedback." },
    { id: "code", name: "Code Reviewer", icon: "💻", desc: "Focuses on best practices and clean code.", prompt: "You are a senior software engineer conducting a code review. Focus on best practices, performance, edge cases, and clean code. Point out bugs and suggest optimizations." },
    { id: "planner", name: "Study Planner", icon: "📅", desc: "Helps break down topics into manageable schedules.", prompt: "You are an academic study planner. Help the user break down topics into manageable chunks, create schedules, and give effective study strategies like Spaced Repetition and Pomodoro." },
    { id: "language", name: "Language Partner", icon: "🗣️", desc: "Practices conversation and corrects grammar politely.", prompt: "You are a language exchange partner. Keep the conversation flowing in the target language. Politely correct any grammar or vocabulary mistakes the user makes." },
    { id: "interviewer", name: "Mock Interviewer", icon: "👔", desc: "Acts as a tough but fair technical/behavioral interviewer.", prompt: "You are a mock interviewer. Ask a question, wait for the user to answer, and then ask follow-up questions or provide feedback. Be tough but fair." },
    { id: "research", name: "Research Assistant", icon: "🔬", desc: "Extracts key findings and summarizes long papers.", prompt: "You are a research assistant. Help summarize long papers, extract key findings, and formulate hypotheses." }
  ];
  let customPersonas = [];
  let activePersonaId = "default";
  
  let activeId = null;
  let agentMode = config.agentDefault;
  let traceCounter = 0;
  let inFlight = false;
  let pendingImages = []; // array of { b64, mime } staged for the next send

  // simple in-memory + persisted "notes" store the model can write to / read from
  function loadNotes(convId){
    return JSON.parse(localStorage.getItem("signal_notes_" + convId) || "[]");
  }
  function saveNotes(convId, notes){
    localStorage.setItem("signal_notes_" + convId, JSON.stringify(notes));
  }

  // ---------- persistence ----------
  function persist(){
    if (window.electronAPI) {
      const active = getActive();
      if (active) window.electronAPI.saveChat(active);
    } else {
      localStorage.setItem("signal_conversations", JSON.stringify(conversations));
    }
  }
  async function persistFolders(){
    if (window.electronAPI) {
      await window.electronAPI.saveData("folders", folders);
    } else {
      localStorage.setItem("signal_folders", JSON.stringify(folders));
    }
  }
  async function persistMemories(){
    if (window.electronAPI) {
      await window.electronAPI.saveData("memories", memories);
    } else {
      localStorage.setItem("signal_memories", JSON.stringify(memories));
    }
  }
  async function persistKBs(){
    if (window.electronAPI) {
      await window.electronAPI.saveData("kbs", folderKBs);
    } else {
      localStorage.setItem("signal_kbs", JSON.stringify(folderKBs));
    }
  }
  async function persistPersonas(){
    if (window.electronAPI) {
      await window.electronAPI.saveData("personas", customPersonas);
    } else {
      localStorage.setItem("signal_personas", JSON.stringify(customPersonas));
    }
  }
  function persistConfig(){
    localStorage.setItem("signal_config", JSON.stringify(config));
  }

  function newConversation(){
    const conv = { id: "c" + Date.now(), title: "untitled", folderId: activeFolderId, personaId: activePersonaId, messages: [] };
    conversations.unshift(conv);
    activeId = conv.id;
    persist();
    renderChatList();
    renderMessages();
    renderActiveChatUI();
  }

  function loadChat(id){
    activeId = id;
    renderChatList();
    renderMessages();
    renderActiveChatUI();
  }

  function getActive(){
    return conversations.find(c => c.id === activeId);
  }
