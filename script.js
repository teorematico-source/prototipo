document.addEventListener("DOMContentLoaded", () => {
    const $ = (selector) => document.querySelector(selector);
    const $$ = (selector) => [...document.querySelectorAll(selector)];
    const storageKeys = {
        settings: "miller-ai-settings",
        chats: "miller-ai-chats",
        projects: "miller-ai-projects"
    };
    const elements = {
        sidebar: $("#sidebar"),
        chatView: $("#chat-view"),
        welcome: $("#welcome"),
        messages: $("#messages"),
        loading: $("#loading"),
        chatForm: $("#chat-form"),
        messageInput: $("#message-input"),
        fileInput: $("#file-input"),
        attachFiles: $("#attach-files"),
        attachmentList: $("#attachment-list"),
        history: $("#chat-history"),
        historyView: $("#history-view"),
        historyList: $("#history-list"),
        projectsView: $("#projects-view"),
        projectsList: $("#projects-list"),
        projectForm: $("#project-form"),
        projectName: $("#project-name"),
        settingsModal: $("#settings-modal"),
        settingsForm: $("#settings-form"),
        settingsStatus: $("#settings-status"),
        chatModel: $("#chat-model-select"),
        memory: $("#memory-input"),
        mathToggle: $("#math-mode-toggle"),
        accessModal: $("#access-modal"),
        accessForm: $("#access-form"),
        accessPassword: $("#access-password"),
        accessStatus: $("#access-status")
    };

    elements.accessForm?.addEventListener("submit", async (event) => {
        event.preventDefault();
        const submitButton = elements.accessForm.querySelector("button[type='submit']");
        submitButton.disabled = true;
        elements.accessStatus.textContent = "Comprobando acceso…";
        try {
            const response = await fetch("/api/login", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ password: elements.accessPassword.value })
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(result.error || "No se pudo validar el acceso.");
            elements.accessModal.classList.add("hidden");
            elements.accessPassword.value = "";
        } catch (error) {
            elements.accessStatus.textContent = error.message || "No se pudo conectar con el servidor.";
        } finally {
            submitButton.disabled = false;
        }
    });

    fetch("/api/session").then((response) => {
        if (response.ok) {
            elements.accessModal?.classList.add("hidden");
        } else if (response.status === 503 && elements.accessStatus) {
            elements.accessStatus.textContent = "El acceso aún no está configurado en el servidor.";
        }
    }).catch(() => {
        if (elements.accessStatus) elements.accessStatus.textContent = "No se pudo conectar con el servidor.";
    });

    const readStorage = (key, fallback) => {
        try {
            const value = localStorage.getItem(key);
            return value ? JSON.parse(value) : fallback;
        } catch {
            return fallback;
        }
    };
    const writeStorage = (key, value) => {
        try {
            localStorage.setItem(key, JSON.stringify(value));
            return true;
        } catch {
            return false;
        }
    };
    let settings = readStorage(storageKeys.settings, {});
    let chats = readStorage(storageKeys.chats, []);
    let projects = readStorage(storageKeys.projects, []);
    if (!settings || typeof settings !== "object" || Array.isArray(settings)) settings = {};
    if (!settings.model || settings.model === "deepseek/deepseek-r1" || settings.model === "google/gemma-4-31b-it:free" || settings.model === "nvidia/nemotron-3-ultra-550b-a55b:free") {
        settings.model = "nvidia/nemotron-3-ultra-550b-a55b";
    }
    delete settings.apiKey;
    settings.memory = typeof settings.memory === "string" ? settings.memory : "";
    delete settings.supabaseUrl;
    delete settings.supabaseAnonKey;
    writeStorage(storageKeys.settings, settings);
    if (!Array.isArray(chats)) chats = [];
    if (!Array.isArray(projects)) projects = [];
    chats = chats
        .filter((chat) => chat && typeof chat.id === "string" && Array.isArray(chat.messages))
        .map((chat) => ({
            ...chat,
            title: typeof chat.title === "string" ? chat.title : "Nueva conversación",
            updatedAt: Number.isFinite(chat.updatedAt) ? chat.updatedAt : 0,
            messages: chat.messages.filter((message) => message && ["user", "assistant"].includes(message.role) && typeof message.content === "string")
        }))
        .slice(-50);
    projects = projects.filter((project) => project && typeof project.name === "string");
    writeStorage(storageKeys.chats, chats);
    if (elements.chatModel) {
        const supportedModels = [...elements.chatModel.options].map((option) => option.value);
        if (!supportedModels.includes(settings.model)) settings.model = "nvidia/nemotron-3-ultra-550b-a55b";
        elements.chatModel.value = settings.model;
    }

    let activeChatId = null;
    let mathMode = false;
    let isRequesting = false;
    let selectedFiles = [];
    let attachmentNotice = "";
    let attachmentPreviewUrls = [];
    const maxSavedChats = 50;
    const persistChats = () => writeStorage(storageKeys.chats, chats);

    function readAsDataUrl(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error("No se pudo leer la imagen."));
            reader.readAsDataURL(file);
        });
    }

    function renderAttachments() {
        if (!elements.attachmentList) return;
        attachmentPreviewUrls.forEach((url) => URL.revokeObjectURL(url));
        attachmentPreviewUrls = [];
        elements.attachmentList.replaceChildren();
        elements.attachmentList.classList.toggle("hidden", !selectedFiles.length && !attachmentNotice);
        selectedFiles.forEach((file, index) => {
            const chip = document.createElement("span");
            chip.className = "attachment-chip";
            if (file.type.startsWith("image/")) {
                const preview = document.createElement("img");
                preview.className = "attachment-preview";
                preview.src = URL.createObjectURL(file);
                preview.alt = `Vista previa de ${file.name}`;
                attachmentPreviewUrls.push(preview.src);
                chip.append(preview);
            } else {
                const fileIcon = document.createElement("span");
                fileIcon.textContent = "📄";
                fileIcon.setAttribute("aria-hidden", "true");
                chip.append(fileIcon);
            }
            const fileName = document.createElement("span");
            fileName.className = "attachment-name";
            fileName.textContent = file.name;
            chip.append(fileName);
            const remove = document.createElement("button");
            remove.type = "button";
            remove.className = "attachment-remove";
            remove.textContent = "×";
            remove.setAttribute("aria-label", `Quitar ${file.name}`);
            remove.addEventListener("click", () => {
                selectedFiles.splice(index, 1);
                renderAttachments();
            });
            chip.append(remove);
            elements.attachmentList.append(chip);
        });
        if (attachmentNotice) {
            const notice = document.createElement("span");
            notice.className = "attachment-notice";
            notice.textContent = attachmentNotice;
            elements.attachmentList.append(notice);
        }
    }

    function processIncomingFiles(incoming) {
        attachmentNotice = "";
        const acceptedImages = ["image/jpeg", "image/png", "image/webp", "image/gif"];
        const acceptedText = /\.(txt|md|csv|json|html|css|js|py|java|xml|yml|yaml)$/i;
        const validFiles = incoming.filter((file) => acceptedImages.includes(file.type) || acceptedText.test(file.name));
        const oversizedImages = validFiles.some((file) => acceptedImages.includes(file.type) && file.size > 4 * 1024 * 1024);
        const oversizedText = validFiles.some((file) => !acceptedImages.includes(file.type) && file.size > 1024 * 1024);
        const withinSizeLimit = validFiles.filter((file) => acceptedImages.includes(file.type)
            ? file.size <= 4 * 1024 * 1024
            : file.size <= 1024 * 1024);
        const available = Math.max(0, 5 - selectedFiles.length);
        selectedFiles.push(...withinSizeLimit.slice(0, available));
        if (validFiles.length < incoming.length) attachmentNotice = "Formato no compatible. Usa JPEG, PNG, WebP, GIF o archivos de texto.";
        else if (oversizedImages) attachmentNotice = "Cada imagen debe pesar 4 MB o menos.";
        else if (oversizedText) attachmentNotice = "Cada archivo de texto debe pesar 1 MB o menos.";
        else if (withinSizeLimit.length > available) attachmentNotice = "Puedes adjuntar hasta 5 archivos.";
        renderAttachments();
    }
    const closeSidebar = () => elements.sidebar?.classList.remove("sidebar-open");

    function openSettings() {
        if (!elements.settingsModal) return;
        elements.memory.value = settings.memory || "";
        elements.settingsStatus.textContent = "";
        elements.settingsModal.classList.remove("hidden");
        elements.memory.focus();
    }

    function setView(view) {
        const isHome = view === "home";
        elements.chatView?.classList.toggle("hidden", !isHome);
        elements.historyView?.classList.toggle("hidden", view !== "history");
        elements.projectsView?.classList.toggle("hidden", view !== "projects");
        $$(".nav-item").forEach((button) => {
            const active = button.dataset.view === view;
            button.classList.toggle("active", active);
            if (active) button.setAttribute("aria-current", "page");
            else button.removeAttribute("aria-current");
        });
        closeSidebar();
        if (view === "history") renderHistoryView();
        if (view === "projects") renderProjects();
    }

    function findActiveChat() {
        return chats.find((chat) => chat.id === activeChatId);
    }

    function appendInlineFormatting(parent, text) {
        const tokenPattern = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`)/g;
        let lastIndex = 0;
        let match;
        while ((match = tokenPattern.exec(text))) {
            parent.append(document.createTextNode(text.slice(lastIndex, match.index)));
            const token = match[0];
            const formatted = document.createElement(token.startsWith("`") ? "code" : "strong");
            formatted.textContent = token.slice(token.startsWith("`") ? 1 : 2, token.startsWith("`") ? -1 : -2);
            parent.append(formatted);
            lastIndex = tokenPattern.lastIndex;
        }
        parent.append(document.createTextNode(text.slice(lastIndex)));
    }

    function appendPlainContent(parent, text) {
        const lines = text.replace(/\r/g, "").split("\n");
        let paragraphLines = [];
        let list = null;
        let listType = "";
        const flushParagraph = () => {
            if (!paragraphLines.length) return;
            const paragraph = document.createElement("p");
            appendInlineFormatting(paragraph, paragraphLines.join(" "));
            parent.append(paragraph);
            paragraphLines = [];
        };
        const endList = () => { list = null; listType = ""; };
        const tableRow = (line) => /^\s*\|.*\|\s*$/.test(line);
        const cellsFrom = (line) => line.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());

        for (let index = 0; index < lines.length; index += 1) {
            const line = lines[index];
            const heading = line.match(/^#{1,3}\s+(.+)$/);
            const unordered = line.match(/^\s*[-*+]\s+(.+)$/);
            const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);

            if (tableRow(line) && index + 1 < lines.length && /^\s*\|?\s*:?-{3,}.*\|/.test(lines[index + 1])) {
                flushParagraph();
                endList();
                const headers = cellsFrom(line);
                const table = document.createElement("table");
                const thead = document.createElement("thead");
                const headerRow = document.createElement("tr");
                headers.forEach((cell) => {
                    const th = document.createElement("th");
                    appendInlineFormatting(th, cell);
                    headerRow.append(th);
                });
                thead.append(headerRow);
                table.append(thead);
                const tbody = document.createElement("tbody");
                index += 2;
                while (index < lines.length && tableRow(lines[index])) {
                    const row = document.createElement("tr");
                    cellsFrom(lines[index]).forEach((cell) => {
                        const td = document.createElement("td");
                        appendInlineFormatting(td, cell);
                        row.append(td);
                    });
                    tbody.append(row);
                    index += 1;
                }
                table.append(tbody);
                parent.append(table);
                index -= 1;
            } else if (!line.trim() || /^\s*---+\s*$/.test(line)) {
                flushParagraph();
                endList();
            } else if (heading) {
                flushParagraph();
                endList();
                const title = document.createElement("h3");
                appendInlineFormatting(title, heading[1]);
                parent.append(title);
            } else if (unordered || ordered) {
                flushParagraph();
                const type = ordered ? "ol" : "ul";
                if (!list || listType !== type) {
                    list = document.createElement(type);
                    listType = type;
                    parent.append(list);
                }
                const entry = document.createElement("li");
                appendInlineFormatting(entry, (ordered || unordered)[1]);
                list.append(entry);
            } else {
                endList();
                paragraphLines.push(line.trim());
            }
        }
        flushParagraph();
    }

    function formatIntegralLimits(text) {
        const subscripts = { a: "ₐ", b: "ᵦ", c: "c", d: "d", i: "ᵢ", j: "ⱼ", k: "ₖ", m: "ₘ", n: "ₙ", x: "ₓ", y: "ᵧ", z: "z", "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉", "+": "₊", "-": "₋", "=": "₌" };
        const superscripts = { a: "ᵃ", b: "ᵇ", c: "ᶜ", d: "ᵈ", e: "ᵉ", f: "ᶠ", g: "ᵍ", h: "ʰ", i: "ⁱ", j: "ʲ", k: "ᵏ", l: "ˡ", m: "ᵐ", n: "ⁿ", o: "ᵒ", p: "ᵖ", r: "ʳ", s: "ˢ", t: "ᵗ", u: "ᵘ", v: "ᵛ", w: "ʷ", x: "ˣ", y: "ʸ", z: "ᶻ", "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", "+": "⁺", "-": "⁻", "=": "⁼" };
        const toScript = (value, alphabet) => [...value].map((character) => alphabet[character] || character).join("");
        return text.replace(/\\?int\s*_\{?([a-zA-Z0-9+-]+)\}?\s*\^\{?([a-zA-Z0-9+-]+)\}?/g, (_, lower, upper) => `∫${toScript(lower, subscripts)}${toScript(upper, superscripts)}`)
            .replace(/\\?int\b/g, "∫")
            .replace(/\\?displaystyle\b/g, "");
    }

    function readableMath(latex) {
        return formatIntegralLimits(latex)
            .replace(/\\(?:displaystyle|textstyle|scriptstyle)\b/g, "")
            .replace(/\\(?:left|right)\b/g, "")
            .replace(/\\sqrt\s*\{([^{}]*)\}/g, "√($1)")
            .replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, "($1)/($2)")
            .replace(/\\boxed\s*\{([^{}]*)\}/g, "$1")
            .replace(/\\(?:text|mathrm|mathbf|operatorname)\s*\{([^{}]*)\}/g, "$1")
            .replace(/\\int\b/g, "∫")
            .replace(/\\sum\b/g, "∑")
            .replace(/\\infty\b/g, "∞")
            .replace(/\\to\b/g, "→")
            .replace(/\\times\b/g, "×")
            .replace(/\\cdot\b/g, "·")
            .replace(/\\div\b/g, "÷")
            .replace(/\\pm\b/g, "±")
            .replace(/\\pi\b/g, "π")
            .replace(/\\leq\b/g, "≤")
            .replace(/\\geq\b/g, "≥")
            .replace(/\\neq\b/g, "≠")
            .replace(/\\quad\b/g, "   ")
            .replace(/\\[,;! ]/g, "")
            .replace(/[{}]/g, "")
            .replace(/\\/g, "")
            .trim();
    }

    function renderMath(container) {
        if (window.MathJax?.typesetPromise) {
            window.MathJax.typesetPromise([container]).catch(() => {});
        }
    }

    function renderAssistantContent(container, text) {
        const mathPattern = /\\\[([\s\S]*?)\\\]|\\\(([\s\S]*?)\\\)|\$\$([\s\S]*?)\$\$|\$([^$\n]+)\$/g;
        const formulas = [];
        const protectedText = text.replace(mathPattern, (_, square, round, doubleDollar, singleDollar) => {
            const block = square !== undefined || doubleDollar !== undefined;
            const source = square ?? round ?? doubleDollar ?? singleDollar;
            const marker = `MILLERMATHMARKER${formulas.length}X`;
            formulas.push({ marker, text: source, block });
            return marker;
        });

        appendPlainContent(container, protectedText);
        const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
        const textNodes = [];
        while (walker.nextNode()) textNodes.push(walker.currentNode);
        textNodes.forEach((textNode) => {
            const markerPattern = /(MILLERMATHMARKER\d+X)/g;
            if (!markerPattern.test(textNode.nodeValue)) return;
            markerPattern.lastIndex = 0;
            const fragment = document.createDocumentFragment();
            textNode.nodeValue.split(markerPattern).forEach((part) => {
                const item = formulas.find((formula) => formula.marker === part);
                if (!item) {
                    if (part) fragment.append(document.createTextNode(part));
                    return;
                }
                const formula = document.createElement(item.block ? "div" : "span");
                formula.className = item.block ? "math-block" : "math-inline";
                formula.textContent = item.block ? `\\[${item.text}\\]` : `\\(${item.text}\\)`;
                formula.setAttribute("aria-label", `Fórmula LaTeX: ${item.text}`);
                fragment.append(formula);
            });
            textNode.replaceWith(fragment);
        });
        renderMath(container);
    }

    function addMessage(role, text) {
        const row = document.createElement("article");
        row.className = `message-row ${role === "user" ? "message-user" : "message-assistant"}`;
        const label = document.createElement("span");
        label.className = "message-label";
        label.textContent = role === "user" ? "Tú" : "Miller AI";
        const content = document.createElement("div");
        content.className = "message-content";
        renderAssistantContent(content, text);
        row.append(label, content);
        elements.messages.append(row);
        return row;
    }

    function renderChat(chat) {
        activeChatId = chat?.id || null;
        elements.messages.replaceChildren();
        elements.welcome?.classList.toggle("hidden", Boolean(chat?.messages?.length));
        chat?.messages?.forEach((message) => addMessage(message.role, message.displayContent || message.content));
        $("#chat-scroll")?.scrollTo({ top: $("#chat-scroll").scrollHeight, behavior: "smooth" });
        setView("home");
        renderChatHistory();
    }

    function renderChatHistory() {
        if (!elements.history) return;
        elements.history.replaceChildren();
        if (!chats.length) {
            const empty = document.createElement("p");
            empty.className = "chat-history-empty";
            empty.textContent = "Aún no tienes conversaciones. Inicia un nuevo chat para empezar.";
            elements.history.append(empty);
            return;
        }
        [...chats].sort((a, b) => b.updatedAt - a.updatedAt).forEach((chat) => {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "chat-item";
            button.textContent = chat.title || "Nueva conversación";
            button.title = button.textContent;
            button.addEventListener("click", () => renderChat(chat));
            elements.history.append(button);
        });
    }

    function renderHistoryView() {
        if (!elements.historyList) return;
        elements.historyList.replaceChildren();
        const ordered = [...chats].sort((a, b) => b.updatedAt - a.updatedAt);
        if (!ordered.length) {
            const empty = document.createElement("p");
            empty.className = "empty-state";
            empty.textContent = "Todavía no hay conversaciones guardadas.";
            elements.historyList.append(empty);
            return;
        }
        ordered.forEach((chat) => {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "history-entry";
            button.textContent = chat.title || "Nueva conversación";
            button.addEventListener("click", () => renderChat(chat));
            elements.historyList.append(button);
        });
    }

    function renderProjects() {
        if (!elements.projectsList) return;
        elements.projectsList.replaceChildren();
        if (!projects.length) {
            const empty = document.createElement("p");
            empty.className = "empty-state";
            empty.textContent = "Aún no tienes proyectos. Crea uno para empezar.";
            elements.projectsList.append(empty);
            return;
        }
        projects.forEach((project, index) => {
            const card = document.createElement("article");
            card.className = "project-entry";
            const name = document.createElement("strong");
            name.textContent = project.name;
            const remove = document.createElement("button");
            remove.type = "button";
            remove.className = "remove-project";
            remove.textContent = "Eliminar";
            remove.setAttribute("aria-label", `Eliminar proyecto ${project.name}`);
            remove.addEventListener("click", () => {
                projects.splice(index, 1);
                writeStorage(storageKeys.projects, projects);
                renderProjects();
            });
            card.append(name, remove);
            elements.projectsList.append(card);
        });
    }

    function ensureChat(firstMessage) {
        let chat = findActiveChat();
        if (!chat) {
            chat = {
                id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                title: firstMessage.slice(0, 48) || "Nueva conversación",
                messages: [],
                updatedAt: Date.now()
            };
            chats.push(chat);
            if (chats.length > maxSavedChats) chats.shift();
            activeChatId = chat.id;
        }
        return chat;
    }

    async function requestAssistant(chat, imageAttachments = []) {
        elements.loading.classList.remove("hidden");
        try {
            const systemParts = ["Responde en español colombiano, con un tono rolo, relajado, natural y directo, como alguien conversando sin impostar una personalidad. La usuaria siempre se llama Lina: dirígete a ella como Lina cuando uses su nombre y no la llames de otra forma. Puedes usar expresiones como «parce», «bro», «de una» o «JAJAJA» solo cuando salgan de forma genuina; no las repitas por costumbre ni las fuerces. Mantén siempre un trato lindo, cálido, amable y respetuoso con Lina, incluso al corregirla o disentir; que se sienta natural, sin exagerar ni sonar forzado. Prioriza la lógica: explica por qué ocurren las cosas, distingue hechos de suposiciones y señala con respeto lo que no tenga sentido o lo que no se sabe. Usa humor sutil o un toque de sarcasmo cuando encaje, sin burlarte del usuario; puedes aludir ocasionalmente a personajes inteligentes que sobrepiensan, sin convertirlo en muletilla. En temas emocionales, sé empático y honesto: reconoce que entender una situación no siempre hace fácil decidir qué hacer, y no reduzcas los sentimientos a una ecuación. Escribe con naturalidad y sustancia, sin frases vacías ni adornos artificiales. Mantén la precisión y adapta el nivel de detalle a la pregunta. Para matemáticas, escribe las expresiones en LaTeX: usa \\(...\\) para fórmulas en línea y \\[...\\] para fórmulas destacadas."];
            systemParts.push("Si el usuario pregunta quién es tu creador, quién te creó o algo similar, responde claramente que tu creador es el ingeniero Miller Fonseca, futuro doctor.");
            if (settings.memory?.trim()) systemParts.push(`Contexto del usuario: ${settings.memory.trim()}`);
            const previousChats = [...chats]
                .filter((savedChat) => savedChat.id !== chat.id && savedChat.messages.length)
                .sort((a, b) => b.updatedAt - a.updatedAt)
                .slice(0, maxSavedChats)
                .map((savedChat) => {
                    const recentMessages = savedChat.messages.slice(-4).map((message) => {
                        const content = message.content.length > 700 ? `${message.content.slice(0, 700)}…` : message.content;
                        return `${message.role === "user" ? "Usuario" : "Asistente"}: ${content}`;
                    });
                    return `Chat «${savedChat.title}»:\n${recentMessages.join("\n")}`;
                });
            if (previousChats.length) {
                systemParts.push(`Contexto de chats anteriores guardados (úsalo si el usuario pregunta por conversaciones previas; no inventes detalles):\n${previousChats.join("\n\n")}`);
            }
            if (mathMode) systemParts.push("Modo matemático activado: actúa como tutor de matemáticas. Identifica los datos y lo que se pide; define variables y supuestos; muestra el procedimiento paso a paso justificando cada transformación; usa notación LaTeX correcta; simplifica con cuidado y verifica el resultado por sustitución o una comprobación independiente cuando sea posible. Distingue hechos de aproximaciones, no omitas pasos clave ni inventes datos. Si el enunciado es ambiguo o incompleto, indícalo y pregunta lo necesario. Termina con una respuesta final claramente señalada.");
            const apiMessages = chat.messages.map((message, index) => {
                if (imageAttachments.length && index === chat.messages.length - 1 && message.role === "user") {
                    return {
                        role: message.role,
                        content: [
                            { type: "text", text: `${message.content}\n\nImágenes adjuntas: ${imageAttachments.map((image) => image.name).join(", ")}` },
                            ...imageAttachments.map((image) => ({ type: "image_url", image_url: { url: image.dataUrl } }))
                        ]
                    };
                }
                return { role: message.role, content: message.content };
            });
            const response = await fetch("/api/chat", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    model: imageAttachments.length ? "google/gemini-2.5-flash" : (settings.model || "nvidia/nemotron-3-ultra-550b-a55b"),
                    messages: [
                        { role: "system", content: systemParts.join(" ") },
                        ...apiMessages
                    ],
                    max_tokens: 4000
                })
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                const message = typeof data.error === "string" ? data.error : data.error?.message;
                throw new Error(`${message || response.statusText || "Error del servicio"} (HTTP ${response.status})`);
            }
            let content = typeof data.choices?.[0]?.message?.content === "string" ? data.choices[0].message.content : "";
            if (!content.trim()) throw new Error("El servicio no devolvió contenido de texto.");
            if (data.choices?.[0]?.finish_reason === "length") {
                content += "\n\n*La respuesta se interrumpió al alcanzar el límite de longitud del modelo.*";
            }
            chat.messages.push({ role: "assistant", content });
            addMessage("assistant", content);
        } catch (error) {
            const message = `No se pudo obtener una respuesta: ${error.message || "Error de conexión."}`;
            addMessage("assistant", message);
        } finally {
            elements.loading.classList.add("hidden");
            isRequesting = false;
            $("#send-button").disabled = false;
            chat.updatedAt = Date.now();
            persistChats();
            renderChatHistory();
            $("#chat-scroll")?.scrollTo({ top: $("#chat-scroll").scrollHeight, behavior: "smooth" });
        }
    }

    $("#open-sidebar")?.addEventListener("click", () => elements.sidebar?.classList.add("sidebar-open"));
    $("#close-sidebar")?.addEventListener("click", closeSidebar);
    $("#open-settings")?.addEventListener("click", openSettings);
    $("#settings-button")?.addEventListener("click", openSettings);
    $("#close-settings")?.addEventListener("click", () => elements.settingsModal?.classList.add("hidden"));
    $("#close-settings-secondary")?.addEventListener("click", () => elements.settingsModal?.classList.add("hidden"));
    elements.settingsModal?.addEventListener("click", (event) => {
        if (event.target === elements.settingsModal) elements.settingsModal.classList.add("hidden");
    });
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
            elements.settingsModal?.classList.add("hidden");
            closeSidebar();
        }
    });

    elements.chatModel?.addEventListener("change", () => {
        settings.model = elements.chatModel.value;
        writeStorage(storageKeys.settings, settings);
    });

    elements.settingsForm?.addEventListener("submit", (event) => {
        event.preventDefault();
        settings = {
            model: elements.chatModel.value,
            memory: elements.memory.value.trim()
        };
        const saved = writeStorage(storageKeys.settings, settings);
        elements.settingsStatus.textContent = saved
            ? "Preferencias guardadas en este navegador."
            : "No se pudo guardar; revisa la configuración de almacenamiento del navegador.";
    });

    $$(".nav-item").forEach((button) => button.addEventListener("click", () => setView(button.dataset.view)));
    elements.attachFiles?.addEventListener("click", () => elements.fileInput?.click());
    elements.fileInput?.addEventListener("change", () => {
        processIncomingFiles([...elements.fileInput.files]);
        elements.fileInput.value = "";
    });
    elements.messageInput?.addEventListener("paste", (event) => {
        const imageItems = [...(event.clipboardData?.items || [])]
            .filter((item) => item.kind === "file" && item.type.startsWith("image/"));
        if (!imageItems.length) return;
        event.preventDefault();
        const pastedImages = imageItems.map((item, index) => {
            const file = item.getAsFile();
            if (!file) return null;
            const extension = file.type.split("/")[1]?.replace("jpeg", "jpg") || "png";
            return new File([file], `imagen-pegada-${Date.now()}-${index + 1}.${extension}`, { type: file.type });
        }).filter(Boolean);
        processIncomingFiles(pastedImages);
    });
    $$(".suggestion-card").forEach((card) => card.addEventListener("click", () => {
        elements.messageInput.value = card.dataset.prompt || "";
        elements.messageInput.focus();
        elements.messageInput.dispatchEvent(new Event("input", { bubbles: true }));
    }));

    $("#new-chat")?.addEventListener("click", () => {
        renderChat(null);
        elements.messageInput.focus();
    });
    $("#clear-chats")?.addEventListener("click", () => {
        if (!chats.length || !window.confirm("¿Borrar todas las conversaciones guardadas?")) return;
        chats = [];
        activeChatId = null;
        persistChats();
        renderChat(null);
        renderHistoryView();
    });

    elements.chatForm?.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (isRequesting) return;
        const text = elements.messageInput.value.trim();
        if (!text && !selectedFiles.length) return;
        let fileContents = [];
        let imageAttachments = [];
        try {
            const loadedFiles = await Promise.all(selectedFiles.map(async (file) => {
                if (file.type.startsWith("image/")) {
                    return { name: file.name, dataUrl: await readAsDataUrl(file), type: "image" };
                }
                return { name: file.name, text: await file.text(), type: "text" };
            }));
            fileContents = loadedFiles.filter((file) => file.type === "text");
            imageAttachments = loadedFiles.filter((file) => file.type === "image");
        } catch {
            attachmentNotice = "No se pudo leer uno de los archivos.";
            renderAttachments();
            return;
        }
        const userPrompt = text || (selectedFiles.length ? "Analiza los archivos adjuntos." : "");
        const attachmentText = fileContents.map(({ name, text: content }) => `\n\n--- Archivo: ${name} ---\n${content}`).join("");
        const messageContent = `${userPrompt}${attachmentText}`.trim();
        const fileNames = selectedFiles.map(({ name }) => name);
        const displayText = [userPrompt, fileNames.length ? `📎 ${fileNames.join(", ")}` : ""].filter(Boolean).join("\n");
        const chat = ensureChat(text || fileNames[0] || "Archivos adjuntos");
        chat.messages.push({ role: "user", content: messageContent, displayContent: displayText });
        chat.updatedAt = Date.now();
        addMessage("user", displayText);
        elements.welcome?.classList.add("hidden");
        elements.messageInput.value = "";
        elements.messageInput.style.height = "";
        selectedFiles = [];
        attachmentNotice = "";
        renderAttachments();
        persistChats();
        renderChatHistory();
        isRequesting = true;
        $("#send-button").disabled = true;
        await requestAssistant(chat, imageAttachments);
    });

    elements.messageInput?.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            elements.chatForm.requestSubmit();
        }
    });
    elements.messageInput?.addEventListener("input", () => {
        elements.messageInput.style.height = "auto";
        elements.messageInput.style.height = `${Math.min(elements.messageInput.scrollHeight, 160)}px`;
    });

    elements.mathToggle?.addEventListener("click", () => {
        mathMode = !mathMode;
        elements.mathToggle.setAttribute("aria-pressed", String(mathMode));
    });

    elements.projectForm?.addEventListener("submit", (event) => {
        event.preventDefault();
        const name = elements.projectName.value.trim();
        if (!name) return;
        projects.push({ id: `${Date.now()}`, name });
        writeStorage(storageKeys.projects, projects);
        elements.projectName.value = "";
        renderProjects();
    });

    const liveClock = document.querySelector("#live-clock");
    const updateClock = () => {
        if (!liveClock) return;
        liveClock.textContent = new Intl.DateTimeFormat("es-CO", {
            day: "2-digit",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false
        }).format(new Date());
    };
    updateClock();
    window.setInterval(updateClock, 1000);

    renderChatHistory();
    renderProjects();
    renderHistoryView();
    if (chats.length) {
        const latest = [...chats].sort((a, b) => b.updatedAt - a.updatedAt)[0];
        renderChat(latest);
    }
});
