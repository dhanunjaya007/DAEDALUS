  // ---------- tool definitions ----------
  const TOOLS = [
    {
      type: "function",
      function: {
        name: "get_current_time",
        description: "Get the current local date and time.",
        parameters: { type: "object", properties: {}, required: [] }
      }
    },
    {
      type: "function",
      function: {
        name: "calculate",
        description: "Evaluate a basic arithmetic expression, e.g. '18% of 462' style or '(4+5)*3'.",
        parameters: {
          type: "object",
          properties: { expression: { type: "string", description: "arithmetic expression to evaluate" } },
          required: ["expression"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "remember_note",
        description: "Save a short note to this conversation's memory for later recall.",
        parameters: {
          type: "object",
          properties: { note: { type: "string", description: "the note text to store" } },
          required: ["note"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "recall_notes",
        description: "Retrieve all notes saved earlier in this conversation.",
        parameters: { type: "object", properties: {}, required: [] }
      }
    },
    {
      type: "function",
      function: {
        name: "search_web",
        description: "Search the web for current events, news, and live information.",
        parameters: {
          type: "object",
          properties: { query: { type: "string", description: "the search query" } },
          required: ["query"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "run_python",
        description: "Execute a Python script securely on the local computer to analyze data, perform complex math, or run scripts. Output is returned. DO NOT use this to run C, C++, or other non-Python languages. If the user provides C/C++ code, do not run it, just analyze it statically.",
        parameters: {
          type: "object",
          properties: { code: { type: "string", description: "ONLY the raw Python code to execute. Do not include markdown formatting, backticks, conversational text, or the user's prompt. Just the executable code." } },
          required: ["code"]
        }
      }
    },
    {
      type: "function",
      function: {
        name: "run_javascript",
        description: "Execute JavaScript code (Node.js) on the local computer to analyze data or run scripts. Output is returned.",
        parameters: {
          type: "object",
          properties: { code: { type: "string", description: "ONLY the raw JavaScript (Node) code to execute. Do not include markdown formatting, backticks, or conversational text. Just the executable code." } },
          required: ["code"]
        }
      }
    }
  ];

  async function executeTool(name, args, convId){
    if (name === "get_current_time"){
      return new Date().toString();
    }
    if (name === "calculate"){
      try {
        let expr = String(args.expression || "");
        // handle "X% of Y" pattern
        const pctMatch = expr.match(/([\d.]+)\s*%\s*of\s*([\d.]+)/i);
        if (pctMatch){
          const result = (parseFloat(pctMatch[1]) / 100) * parseFloat(pctMatch[2]);
          return String(result);
        }
        // safe-ish arithmetic eval: only digits, operators, parens, decimal points
        if (!/^[\d\s+\-*/().%]+$/.test(expr)){
          return "error: expression contains disallowed characters";
        }
        // eslint-disable-next-line no-new-func
        const result = Function('"use strict"; return (' + expr + ')')();
        return String(result);
      } catch (e){
        return "error: could not evaluate expression";
      }
    }
    if (name === "remember_note"){
      const notes = loadNotes(convId);
      notes.push({ text: args.note, at: new Date().toISOString() });
      saveNotes(convId, notes);
      return "note saved";
    }
    if (name === "recall_notes"){
      const notes = loadNotes(convId);
      if (notes.length === 0) return "no notes saved in this conversation yet";
      return notes.map((n,i) => (i+1) + ". " + n.text).join("\n");
    }
    if (name === "search_web"){
      if (!window.electronAPI) return "error: search_web only works in the desktop app";
      try {
        const res = await window.electronAPI.searchWeb(args.query);
        if (!res.success) return "error: " + res.error;
        if (res.results.length === 0) return "no results found";
        return res.results.map(r => `Title: ${r.title}\nSnippet: ${r.snippet}\nURL: ${r.url}`).join("\n\n");
      } catch (e) {
        return "error: " + e.message;
      }
    }
    if (name === "run_python" || name === "run_javascript"){
      if (!window.electronAPI) return `error: ${name} only works in the desktop app`;
      try {
        const res = await window.electronAPI.executeCode(name, args.code || "");
        if (!res.success) return "error: " + res.error;
        return res.output || "Code executed successfully with no output.";
      } catch (e) {
        return "error: " + e.message;
      }
    }
    return "error: unknown tool " + name;
  }
