const fs = require('fs');

const overrides = {
  "السلات": "Carritos",
  "سلات متروكة": "Carritos Abandonados",
  "الطلبات": "Pedidos",
  "المنتجات": "Productos",
  "إعدادات": "Configuración",
  "حفظ التغييرات": "Guardar Cambios",
  "التذكيرات": "Recordatorios",
  "الرسائل": "Mensajes",
  "دخول": "Entrar",
  "كلمة مرور الإدارة": "Contraseña de Admin",
  "إجمالي الطلبات": "Total Pedidos",
  "إجمالي الإيرادات": "Ingresos Totales",
  "إضافة منتج": "Añadir Producto",
  "منتجاتي": "Mis Productos",
  "رقمي": "Raqmiy",
  "دفع آمن": "Pago Seguro"
};

async function translateText(text) {
  if (overrides[text]) return overrides[text];
  try {
    const res = await fetch('https://translate.googleapis.com/translate_a/single?client=gtx&sl=ar&tl=es&dt=t&q=' + encodeURIComponent(text));
    const data = await res.json();
    return data[0].map(x => x[0]).join('');
  } catch (e) {
    console.error("Error translating:", text);
    return text;
  }
}

async function run() {
  const phrases = JSON.parse(fs.readFileSync('arabic_phrases.json', 'utf8'));
  const dictionary = {};
  
  console.log(`Translating ${phrases.length} phrases...`);
  
  // Sort by length descending to replace longer phrases first (prevents partial replacements)
  phrases.sort((a, b) => b.length - a.length);
  
  for (let i = 0; i < phrases.length; i++) {
    const ar = phrases[i];
    dictionary[ar] = await translateText(ar);
    if (i % 20 === 0) console.log(`Translated ${i}/${phrases.length}`);
  }
  
  console.log("Translation complete. Applying to files...");
  
  const files = ['admin.html', 'panel.html', 'checkout.html', 'success.html'];
  
  files.forEach(f => {
    if (!fs.existsSync(f)) return;
    let content = fs.readFileSync(f, 'utf8');
    
    // Replace rtl with ltr and lang="ar" with lang="es"
    content = content.replace(/dir="rtl"/g, 'dir="ltr"');
    content = content.replace(/lang="ar"/g, 'lang="es"');
    
    // Replace phrases
    for (const ar of phrases) {
      const es = dictionary[ar];
      // Using literal replace for exact matches, global where possible
      const escapedAr = ar.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escapedAr, 'g');
      content = content.replace(regex, es);
    }
    
    fs.writeFileSync(f, content);
    console.log(`Updated ${f}`);
  });
  
  console.log("All done!");
}

run();
