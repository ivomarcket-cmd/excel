const DEFAULT_CONFIG = {
  // Información Global y SEO
  metaTitle: "Mega Pack Plantillas Excel | La Colección Definitiva",
  metaDescription: "Más de 3000 plantillas Excel profesionales para contabilidad, RRHH, ingeniería, finanzas y más. Organiza tu negocio hoy.",
  checkoutUrl: "./checkout.html",
  precioNormal: 102,
  precioOferta: 12,
  currency: "USD",
  
  // Textos y Enlaces
  heroPromesa: "El Mega Pack de Plantillas Excel Más Completo del Mercado",
  heroSubpromesa: "Ahorra cientos de horas de trabajo con herramientas profesionales listas para usar en Finanzas, Recursos Humanos, Ingeniería, Ventas y más.",
  
  autorNombre: "Equipo Mega Pack",
  autorProfesion: "Expertos en Gestión Empresarial",
  autorBio: "Hemos recopilado, optimizado y organizado las mejores plantillas corporativas para que no tengas que empezar ningún proyecto desde cero.",

  // 8 Imágenes proporcionadas por el usuario (Cloudinary)
  heroImage: "https://res.cloudinary.com/dcueissks/image/upload/v1781379721/fae383b3-70bc-4272-9425-d7d5428c63e8_sfrccu.png",
  objecionesImage: "https://res.cloudinary.com/dcueissks/image/upload/v1781379721/6e8e805d-25e9-45e1-a76c-e5e751a41c27_avlnam.png",
  metodoImage: "https://res.cloudinary.com/dcueissks/image/upload/v1781379720/614c9e38-6aac-4528-8f77-e1e7d69c1a4a_y3h5aj.png",
  ofertaPaqueteImage: "https://res.cloudinary.com/dcueissks/image/upload/v1781379720/e987a8ff-e89a-4e33-a12c-ee22dbb9ea3f_gfwtx6.png",
  
  // Asignamos las demás imágenes a bonos/testimonios/garantía para darles uso
  garantiaImage: "https://res.cloudinary.com/dcueissks/image/upload/v1781379720/b4fec26b-dcaf-46d6-b18a-ab6a9826fd28_nkmqdu.png",
  
  testimonios: [
    "https://res.cloudinary.com/dcueissks/image/upload/v1781379720/a727b37f-82a1-42f6-966f-774e78b36419_mcqrm6.png",
    "https://res.cloudinary.com/dcueissks/image/upload/v1781379720/c26fbb38-c4f8-47e8-a547-ccaa061c5e56_kufix5.png",
    "https://res.cloudinary.com/dcueissks/image/upload/v1781379720/72cbac34-0ba8-472c-a027-d0e3449149ac_qlma1i.png"
  ],

  // Categorías extraídas de las imágenes del usuario
  categorias: [
    { nombre: "Contabilidad y Finanzas", icon: "fa-calculator", sub: ["Contabilidad", "Facturación", "Estados financieros", "Control Ingresos y Egresos", "Caja", "Relacionadas con impuestos"] },
    { nombre: "Gestión Empresarial", icon: "fa-briefcase", sub: ["Administración", "CRM's", "Planes de Negocio", "Gestión de Ventas", "Recursos Humanos"] },
    { nombre: "Análisis y Reportes", icon: "fa-chart-pie", sub: ["Dashboards de ventas", "Análisis Visual", "KPI'S En Excel"] },
    { nombre: "Sectores Específicos", icon: "fa-industry", sub: ["Ingenieros Civiles", "Plantillas para Construcción", "Administración de propiedades", "Plantillas para Restaurantes"] },
    { nombre: "Finanzas Personales", icon: "fa-wallet", sub: ["Finanzas personales", "Planificación financiera", "Finalidad Financiera", "Inversiones"] },
    { nombre: "Productividad y Tareas", icon: "fa-tasks", sub: ["Gestión de proyectos", "Diagramas de Gantt", "Lista de tareas y verificación", "Inventario", "Redes Sociales"] }
  ],

  bonos: [
    { titulo: "Ebook: Ahorro Inteligente", descripcion: "Sistema probado para salir de deudas.", precioNormal: "$68", imagen: "https://res.cloudinary.com/dcueissks/image/upload/v1781379720/c26fbb38-c4f8-47e8-a547-ccaa061c5e56_kufix5.png" },
    { titulo: "Ebook: Gastos Imprevistos", descripcion: "Guía para manejar emergencias.", precioNormal: "$12", imagen: "https://res.cloudinary.com/dcueissks/image/upload/v1781379720/a727b37f-82a1-42f6-966f-774e78b36419_mcqrm6.png" },
    { titulo: "Ebook: Ingresos Bajos", descripcion: "Método realista para maximizar ganancias.", precioNormal: "$12", imagen: "https://res.cloudinary.com/dcueissks/image/upload/v1781379720/72cbac34-0ba8-472c-a027-d0e3449149ac_qlma1i.png" }
  ],

  faq: [
    { pregunta: "¿Qué incluye exactamente este mega pack?", respuesta: "Incluye plantillas premium organizadas en más de 20 categorías profesionales (Contabilidad, RRHH, Ingeniería, Inmobiliaria, etc.), además de 3 ebooks exclusivos de bonificación." },
    { pregunta: "¿Necesito conocimientos avanzados de Excel?", respuesta: "No, las plantillas vienen pre-configuradas con fórmulas y dashboards listos para usar. Solo necesitas ingresar tus datos." },
    { pregunta: "¿Es un pago único o mensual?", respuesta: "Es un pago único. Te descargas todas las carpetas y los archivos son tuyos para siempre." },
    { pregunta: "¿Sirven para Mac y Windows?", respuesta: "Sí, son archivos nativos de Excel (.xlsx) compatibles con cualquier versión reciente de Office en Mac o Windows, e incluso Google Sheets." }
  ]
};

let SITE_CONFIG = { ...DEFAULT_CONFIG };

async function loadSiteConfig() {
  try {
    const response = await fetch("/api/config", { cache: "no-store" });
    if (!response.ok) throw new Error("API not accessible");
    const remoteConfig = await response.json();
    
    if (remoteConfig.productName) SITE_CONFIG.metaTitle = remoteConfig.productName;
    if (remoteConfig.price) SITE_CONFIG.precioOferta = remoteConfig.price;
    if (remoteConfig.currency) SITE_CONFIG.currency = remoteConfig.currency;
    
  } catch (error) {
    console.warn("Usando configuración local. Para probar el checkout necesitas el backend funcionando.");
  }
}

function renderContent() {
  const config = SITE_CONFIG;

  document.getElementById("seo-title").textContent = config.metaTitle;
  document.getElementById("seo-desc").setAttribute("content", config.metaDescription);

  document.querySelectorAll(".dynamic-checkout-link").forEach(link => {
    link.href = config.checkoutUrl;
  });

  document.getElementById("text-hero-promesa").textContent = config.heroPromesa;
  document.getElementById("text-hero-subpromesa").textContent = config.heroSubpromesa;
  document.getElementById("text-precio-normal").textContent = `$${config.precioNormal}`;
  document.getElementById("text-precio-oferta").textContent = `$${config.precioOferta}`;
  
  const stickyPrice = document.getElementById("sticky-price");
  if(stickyPrice) stickyPrice.textContent = `(por solo $${config.precioOferta})`;

  // Imágenes principales
  document.getElementById("hero").style.backgroundImage = `url('${config.heroImage}')`;
  const imgObjeciones = document.getElementById("img-objeciones");
  if(imgObjeciones) imgObjeciones.src = config.objecionesImage;
  
  const imgMetodo = document.getElementById("img-metodo");
  if(imgMetodo) imgMetodo.src = config.metodoImage;
  
  const imgOferta = document.getElementById("img-oferta");
  if(imgOferta) imgOferta.src = config.ofertaPaqueteImage;
  
  const imgGarantia = document.getElementById("img-garantia");
  if(imgGarantia) imgGarantia.src = config.garantiaImage;

  // Renderizar Categorías
  const categoriasContainer = document.getElementById("categorias-container");
  if (categoriasContainer) {
    categoriasContainer.innerHTML = '';
    config.categorias.forEach(cat => {
      const card = document.createElement("div");
      card.className = "glass-card text-left";
      card.style.padding = "2rem";
      card.style.borderTop = "4px solid var(--color-accent)";
      
      let listHtml = cat.sub.map(item => `
        <li style="margin-bottom: 0.5rem; display: flex; align-items: center; font-size: 0.95rem;">
          <i class="fas fa-check-circle" style="color: var(--color-accent); margin-right: 10px; font-size: 0.9rem;"></i> ${item}
        </li>
      `).join('');

      card.innerHTML = `
        <h3 class="font-bold mb-3" style="font-size: 1.25rem; color: #fff; display: flex; align-items: center;">
          <i class="fas ${cat.icon}" style="color: var(--color-accent); margin-right: 12px; font-size: 1.5rem;"></i>
          ${cat.nombre}
        </h3>
        <ul style="list-style: none; padding: 0; opacity: 0.9; margin-top: 1.5rem;">
          ${listHtml}
        </ul>
      `;
      categoriasContainer.appendChild(card);
    });
  }

  // Renderizar Testimonios (Fotos)
  const testimoniosContainer = document.getElementById("testimonios-container");
  if (testimoniosContainer) {
    testimoniosContainer.innerHTML = '';
    config.testimonios.forEach(imgUrl => {
      const img = document.createElement("img");
      img.src = imgUrl;
      img.alt = "Muestra o Testimonio";
      img.className = "testimonial-img";
      img.style.borderRadius = "12px";
      img.style.boxShadow = "0 8px 30px rgba(0,0,0,0.3)";
      testimoniosContainer.appendChild(img);
    });
  }

  // Renderizar Bonos
  const bonosContainer = document.getElementById("bonos-container");
  if (bonosContainer) {
    bonosContainer.innerHTML = '';
    config.bonos.forEach(bono => {
      const card = document.createElement("div");
      card.className = "glass-card text-center";
      card.style.position = "relative";
      
      card.innerHTML = `
        <span class="badge-gratis">GRATIS</span>
        <img src="${bono.imagen}" alt="${bono.titulo}" class="bono-img" style="border-radius: 8px; margin-bottom: 1rem; width: 100%;">
        <h3 class="font-bold mb-1" style="font-size: 1.1rem; color: var(--color-accent);">${bono.titulo}</h3>
        <p style="font-size: 0.9rem; margin-bottom: 1rem; opacity: 0.9;">${bono.descripcion}</p>
        <p style="font-size: 0.85rem;">
          <span style="text-decoration: line-through; opacity: 0.6;">Precio Normal: ${bono.precioNormal}</span> | 
          <span style="color: #4ade80; font-weight: bold;">Hoy Gratis</span>
        </p>
      `;
      bonosContainer.appendChild(card);
    });
  }

  // Renderizar FAQ
  const faqContainer = document.getElementById("faq-container");
  if (faqContainer) {
    faqContainer.innerHTML = '';
    config.faq.forEach((item) => {
      const faqEl = document.createElement("div");
      faqEl.className = "faq-item";
      
      faqEl.innerHTML = `
        <button class="faq-question">
          ${item.pregunta}
          <i class="fas fa-chevron-down faq-icon"></i>
        </button>
        <div class="faq-answer">
          <p style="padding-bottom: 1.5rem;">${item.respuesta}</p>
        </div>
      `;
      
      const btn = faqEl.querySelector(".faq-question");
      btn.addEventListener("click", () => {
        const isActive = faqEl.classList.contains("active");
        document.querySelectorAll(".faq-item").forEach(el => {
          el.classList.remove("active");
          el.querySelector(".faq-answer").style.maxHeight = null;
        });
        if (!isActive) {
          faqEl.classList.add("active");
          const answer = faqEl.querySelector(".faq-answer");
          answer.style.maxHeight = answer.scrollHeight + "px";
        }
      });

      faqContainer.appendChild(faqEl);
    });
  }
}

function initStickyBar() {
  const stickyBar = document.getElementById("mobile-sticky-bar");
  const heroSection = document.getElementById("hero");
  if(!stickyBar || !heroSection) return;
  
  window.addEventListener("scroll", () => {
    if (window.scrollY > heroSection.offsetHeight) {
      stickyBar.classList.add("visible");
    } else {
      stickyBar.classList.remove("visible");
    }
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  await loadSiteConfig();
  renderContent();
  initStickyBar();
});
