export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const orderId = url.searchParams.get("id") || "";
  const token = url.searchParams.get("token") || "";

  if (!orderId || !token) {
    return htmlError("الفاتورة غير موجودة", "رقم الطلب أو رمز الوصول غير موجود.");
  }

  if (!env.SITE_CONFIG_KV) {
    return htmlError("خطأ في الإعدادات", "خدمة التخزين غير متاحة.");
  }

  const order = await env.SITE_CONFIG_KV.get(`order-${orderId}`, "json");

  if (!order) {
    return htmlError("الفاتورة غير موجودة", "رقم الطلب هذا غير موجود.");
  }

  if (!order.invoiceToken || order.invoiceToken !== token) {
    return htmlError("تم رفض الوصول", "رابط الفاتورة غير صالح.");
  }

  return new Response(renderInvoice(order), {
    headers: { "Content-Type": "text/html;charset=UTF-8", "Cache-Control": "no-store" }
  });
}

function renderInvoice(order) {
  const fmt = new Intl.NumberFormat("ar", { style: "currency", currency: order.currency || "USD" }).format(order.amount || 0);
  const date = new Date(order.date);
  const dateFmt = date.toLocaleDateString("ar", { year: "numeric", month: "long", day: "numeric" });
  const method = order.method === "stripe" ? "بطاقة بنكية (Stripe)" : "PayPal";
  const productName = escapeHtml(order.productName || "Digital Products Pack");
  const orderEmail = escapeHtml(order.email || "—");
  const orderRef = escapeHtml(order.sessionId || order.paypalOrderId || order.orderId);
  const orderNumber = escapeHtml(order.orderId);

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>فاتورة ${orderNumber}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Tahoma, Arial, sans-serif; background: #f4f4f5; color: #18181b; line-height: 1.7; direction: rtl; text-align: right; }
    .page { max-width: 760px; margin: 32px auto; background: #fff; border-radius: 10px; box-shadow: 0 4px 32px rgba(0,0,0,.10); overflow: hidden; }
    .stripe { height: 6px; background: linear-gradient(90deg, #fbbf24, #f97316, #fbbf24); }
    .body { padding: 40px 44px; }

    .header { display: flex; justify-content: space-between; align-items: flex-start; gap: 20px; margin-bottom: 36px; }
    .brand { font-size: 1.5rem; font-weight: 900; color: #18181b; }
    .brand span { color: #f59e0b; }
    .brand-email { font-size: .82rem; color: #71717a; margin-top: 3px; }
    .invoice-meta { text-align: left; }
    .invoice-title { font-size: 1.6rem; font-weight: 900; color: #18181b; letter-spacing: -.5px; }
    .invoice-num { font-size: 1rem; font-weight: 700; color: #f59e0b; margin-top: 4px; }
    .invoice-date { font-size: .85rem; color: #71717a; margin-top: 2px; }

    hr { border: 0; border-top: 1px solid #e4e4e7; margin: 28px 0; }

    .bill-section { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 32px; }
    .bill-block h3 { font-size: .75rem; font-weight: 800; color: #a1a1aa; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px; }
    .bill-block p { font-size: .95rem; color: #18181b; }

    table { width: 100%; border-collapse: collapse; margin-bottom: 28px; }
    thead th { padding: 10px 14px; font-size: .75rem; font-weight: 800; color: #71717a; text-transform: uppercase; letter-spacing: .5px; border-bottom: 2px solid #e4e4e7; text-align: right; }
    thead th:last-child { text-align: left; }
    tbody td { padding: 14px; border-bottom: 1px solid #f4f4f5; font-size: .93rem; color: #18181b; }
    tbody td:last-child { text-align: left; font-weight: 700; }
    tfoot td { padding: 12px 14px; font-size: .95rem; }
    .total-row td { border-top: 2px solid #e4e4e7; font-weight: 900; font-size: 1.05rem; color: #18181b; }
    .total-row td:last-child { color: #16a34a; font-size: 1.15rem; }

    .paid-badge { display: inline-flex; align-items: center; gap: 6px; padding: 5px 14px; border-radius: 999px; background: #dcfce7; color: #15803d; font-weight: 800; font-size: .82rem; border: 1px solid #bbf7d0; }

    .footer { margin-top: 32px; padding-top: 20px; border-top: 1px solid #e4e4e7; font-size: .82rem; color: #a1a1aa; text-align: center; }

    .print-btn { display: block; margin: 24px auto 0; padding: 14px 36px; background: #fbbf24; border: 0; border-radius: 8px; font-weight: 900; font-size: 1rem; cursor: pointer; color: #111; }
    .print-btn:hover { background: #f59e0b; }

    @media (max-width: 600px) {
      .body { padding: 24px 20px; }
      .header, .bill-section { grid-template-columns: 1fr; }
      .invoice-meta { text-align: right; }
    }

    @media print {
      body { background: #fff; }
      .page { box-shadow: none; border-radius: 0; margin: 0; }
      .print-btn { display: none; }
    }
  </style>
</head>
<body>
  <div class="page">
    <div class="stripe"></div>
    <div class="body">

      <div class="header">
        <div>
          <div class="brand">Digital <span>Pack</span></div>
          <div class="brand-email">info@digital.raqmiy.com</div>
        </div>
        <div class="invoice-meta">
          <div class="invoice-title">فاتورة</div>
          <div class="invoice-num">${orderNumber}</div>
          <div class="invoice-date">التاريخ: ${dateFmt}</div>
          <div style="margin-top:8px"><span class="paid-badge">✓ مدفوع</span></div>
        </div>
      </div>

      <hr>

      <div class="bill-section">
        <div class="bill-block">
          <h3>البائع</h3>
          <p><strong>Digital Products Pack</strong></p>
          <p>30 N Gould St, STE R</p>
          <p>Sheridan, WY 82801</p>
          <p>United States</p>
          <p>info@digital.raqmiy.com</p>
        </div>
        <div class="bill-block">
          <h3>العميل</h3>
          <p>${orderEmail}</p>
        </div>
      </div>

      <table>
        <thead>
          <tr>
            <th>الوصف</th>
            <th>طريقة الدفع</th>
            <th>الكمية</th>
            <th>الإجمالي</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <strong>${productName}</strong><br>
              <span style="color:#71717a;font-size:.83rem">منتج رقمي — تسليم فوري</span>
            </td>
            <td>${method}</td>
            <td>1</td>
            <td>${fmt}</td>
          </tr>
        </tbody>
        <tfoot>
          <tr><td colspan="3" style="text-align:left;color:#71717a">المجموع الفرعي</td><td style="text-align:left">${fmt}</td></tr>
          <tr><td colspan="3" style="text-align:left;color:#71717a">الضريبة</td><td style="text-align:left;color:#71717a">مشمولة</td></tr>
          <tr class="total-row"><td colspan="3" style="text-align:left">الإجمالي</td><td style="text-align:left">${fmt}</td></tr>
        </tfoot>
      </table>

      <div class="footer">
        <p>هذا المستند إيصال شراء رقمي صالح كإثبات للدفع.</p>
        <p style="margin-top:4px">رقم المرجع: ${orderRef} · ${orderNumber}</p>
      </div>

    </div>
  </div>

  <button class="print-btn" onclick="window.print()">طباعة / حفظ PDF</button>

</body>
</html>`;
}

function htmlError(title, message) {
  return new Response(`<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><title>${escapeHtml(title)}</title>
    <style>body{font-family:Tahoma,Arial,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#050505;color:#f8fafc;direction:rtl;text-align:center}
    .box{text-align:center;padding:40px}h1{color:#fbbf24;margin-bottom:12px}p{color:#a1a1aa}</style></head>
    <body><div class="box"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></div></body></html>`,
    { status: 404, headers: { "Content-Type": "text/html;charset=UTF-8" } }
  );
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
