(function () {
  const texts = {
    en: {
      title: "Digital Products Support",
      role: "Contact form",
      intro: "Hi. Choose what you need and leave your details. We will reply by email.",
      topics: ["I want to buy", "I already paid", "I need help"],
      email: "Email",
      country: "Country",
      message: "How can we help?",
      emailPh: "you@email.com",
      countryPh: "Your country",
      messagePh: "Write your message...",
      send: "Send",
      sending: "Sending...",
      thanks: "Thanks. Your message was sent. We will contact you by email.",
      error: "Could not send the message. Please email info@digital.raqmiy.com.",
      close: "Close"
    },
    es: {
      title: "Soporte productos digitales",
      role: "Formulario de contacto",
      intro: "Hola. Elige qué necesitas y deja tus datos. Te responderemos por email.",
      topics: ["Quiero comprar", "Ya he pagado", "Necesito ayuda"],
      email: "Email",
      country: "País",
      message: "¿En qué podemos ayudarte?",
      emailPh: "tu@email.com",
      countryPh: "Tu país",
      messagePh: "Escribe tu mensaje...",
      send: "Enviar",
      sending: "Enviando...",
      thanks: "Gracias. Tu mensaje se ha enviado. Te contactaremos por email.",
      error: "No se pudo enviar el mensaje. Escríbenos a info@digital.raqmiy.com.",
      close: "Cerrar"
    },
    pt: {
      title: "Suporte produtos digitais",
      role: "Formulário de contacto",
      intro: "Olá. Escolha o que precisa e deixe os seus dados. Responderemos por email.",
      topics: ["Quero comprar", "Já paguei", "Preciso de ajuda"],
      email: "Email",
      country: "País",
      message: "Como podemos ajudar?",
      emailPh: "seu@email.com",
      countryPh: "O seu país",
      messagePh: "Escreva a sua mensagem...",
      send: "Enviar",
      sending: "A enviar...",
      thanks: "Obrigado. A sua mensagem foi enviada. Entraremos em contacto por email.",
      error: "Não foi possível enviar. Email: info@digital.raqmiy.com.",
      close: "Fechar"
    },
    ar: {
      title: "",
      role: "نموذج تواصل",
      intro: "مرحباً. اختر ما تحتاجه واترك بياناتك. سنرد عليك عبر البريد الإلكتروني.",
      topics: ["أريد الشراء", "لقد دفعت بالفعل", "أحتاج مساعدة"],
      email: "البريد الإلكتروني",
      country: "البلد",
      message: "كيف يمكننا مساعدتك؟",
      emailPh: "email@example.com",
      countryPh: "بلدك",
      messagePh: "اكتب رسالتك...",
      send: "إرسال",
      sending: "جار الإرسال...",
      thanks: "شكراً. تم إرسال رسالتك وسنتواصل معك عبر البريد.",
      error: "تعذر إرسال الرسالة. راسلنا على info@digital.raqmiy.com.",
      close: "إغلاق"
    }
  };

  function getLang() {
    const saved = localStorage.getItem("site_lang");
    if (texts[saved]) return saved;
    const htmlLang = (document.documentElement.lang || "").toLowerCase();
    if (htmlLang.startsWith("ar")) return "ar";
    if (htmlLang.startsWith("pt")) return "pt";
    if (htmlLang.startsWith("es")) return "es";
    return "en";
  }

  const lang = getLang();
  const t = texts[lang];
  const isRtl = lang === "ar";

  const root = document.createElement("div");
  root.innerHTML = `
    <button class="support-chat-toggle" type="button" aria-label="${esc(t.title)}">
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 8.5h14M5 13h9M21 11.5a7.5 7.5 0 0 1-7.5 7.5H8l-5 3v-10.5A7.5 7.5 0 0 1 10.5 4h3A7.5 7.5 0 0 1 21 11.5Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </button>
    <section class="support-chat" aria-label="${esc(t.title)}" dir="${isRtl ? "rtl" : "ltr"}">
      <div class="support-chat-head">
        <div class="support-chat-avatar">فريق الدعم</div>
        <div class="support-chat-heading">
          <p class="support-chat-title">${esc(t.title)}</p>
          <p class="support-chat-role"><span class="chat-status-dot"></span>${esc(t.role)}</p>
        </div>
        <button class="support-chat-close" type="button" aria-label="${esc(t.close)}">×</button>
      </div>
      <form class="support-chat-form" id="support-chat-form">
        <p class="support-chat-intro">${esc(t.intro)}</p>
        <div class="support-topic-list" role="group" aria-label="${esc(t.message)}">
          ${t.topics.map((topic, index) => `
            <button class="support-topic${index === 0 ? " selected" : ""}" type="button" data-topic="${escAttr(topic)}">${esc(topic)}</button>
          `).join("")}
        </div>
        <input type="hidden" id="support-topic" value="${escAttr(t.topics[0])}">
        <label class="support-field">
          <span>${esc(t.email)}</span>
          <input id="support-email" type="email" autocomplete="email" placeholder="${escAttr(t.emailPh)}" required>
        </label>
        <label class="support-field">
          <span>${esc(t.country)}</span>
          <input id="support-country" type="text" autocomplete="country-name" placeholder="${escAttr(t.countryPh)}" required>
        </label>
        <label class="support-field">
          <span>${esc(t.message)}</span>
          <textarea id="support-message" rows="3" placeholder="${escAttr(t.messagePh)}" required></textarea>
        </label>
        <p class="support-chat-status" id="support-chat-status" aria-live="polite"></p>
        <button class="support-submit" id="support-submit" type="submit">${esc(t.send)}</button>
      </form>
    </section>
  `;
  document.body.appendChild(root);

  const toggle = root.querySelector(".support-chat-toggle");
  const panel = root.querySelector(".support-chat");
  const close = root.querySelector(".support-chat-close");
  const form = root.querySelector("#support-chat-form");
  const topicInput = root.querySelector("#support-topic");
  const status = root.querySelector("#support-chat-status");
  const submit = root.querySelector("#support-submit");

  function openChat() {
    panel.classList.add("open");
    setTimeout(() => root.querySelector("#support-email")?.focus(), 50);
  }

  function closeChat() {
    panel.classList.remove("open");
  }

  toggle.addEventListener("click", () => {
    panel.classList.contains("open") ? closeChat() : openChat();
  });
  close.addEventListener("click", closeChat);

  root.querySelectorAll(".support-topic").forEach((button) => {
    button.addEventListener("click", () => {
      root.querySelectorAll(".support-topic").forEach((item) => item.classList.remove("selected"));
      button.classList.add("selected");
      topicInput.value = button.dataset.topic || "";
    });
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    status.textContent = "";
    submit.disabled = true;
    submit.textContent = t.sending;

    const email = root.querySelector("#support-email").value.trim();
    const country = root.querySelector("#support-country").value.trim();
    const message = root.querySelector("#support-message").value.trim();
    const topic = topicInput.value.trim();

    try {
      const res = await fetch("/api/chat-lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          country,
          topic,
          message: `[${topic}] ${message}`,
          lang,
          page: location.href
        })
      });
      if (!res.ok) throw new Error("send failed");
      form.reset();
      topicInput.value = t.topics[0];
      root.querySelectorAll(".support-topic").forEach((item, index) => {
        item.classList.toggle("selected", index === 0);
      });
      status.className = "support-chat-status ok";
      status.textContent = t.thanks;
    } catch (_) {
      status.className = "support-chat-status bad";
      status.textContent = t.error;
    } finally {
      submit.disabled = false;
      submit.textContent = t.send;
    }
  });

  function esc(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function escAttr(value) {
    return esc(value).replace(/'/g, "&#39;");
  }
})();
