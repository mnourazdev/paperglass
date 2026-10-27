/**
 * Tiny translation layer for Paperglass (English + Arabic).
 *
 * Static markup is translated through `data-i18n*` attributes; dynamic
 * strings call `t(key, vars)`. Arabic also flips the document to RTL.
 */

const STORAGE_KEY = "paperglass.lang";

const enPages = (n) => `${n} page${n === 1 ? "" : "s"}`;
const enPhotos = (n) => `${n} photo${n === 1 ? "" : "s"}`;
const enFiles = (n) => `${n} file${n === 1 ? "" : "s"}`;
const enImages = (n, ext) => `${n} ${ext} image${n === 1 ? "" : "s"}`;
const enImageWord = (n) => `${n} image${n === 1 ? "" : "s"}`;

const arPages = (n) =>
  n === 1 ? "صفحة واحدة" : n === 2 ? "صفحتان" : n >= 3 && n <= 10 ? `${n} صفحات` : `${n} صفحة`;
// Accusative/genitive form, used after prepositions and verbs.
const arPagesObj = (n) =>
  n === 1 ? "صفحة واحدة" : n === 2 ? "صفحتين" : n >= 3 && n <= 10 ? `${n} صفحات` : `${n} صفحة`;
const arPhotos = (n) =>
  n === 1 ? "صورة واحدة" : n === 2 ? "صورتان" : n >= 3 && n <= 10 ? `${n} صور` : `${n} صورة`;
const arFiles = (n) =>
  n === 1 ? "ملف واحد" : n === 2 ? "ملفين" : n >= 3 && n <= 10 ? `${n} ملفات` : `${n} ملفًا`;
const arImages = (n, ext) =>
  n === 1
    ? `صورة ${ext} واحدة`
    : n === 2
      ? `صورتا ${ext}`
      : n >= 3 && n <= 10
        ? `${n} صور ${ext}`
        : `${n} صورة ${ext}`;
const arImageWord = (n) =>
  n === 1 ? "صورة واحدة" : n === 2 ? "صورتان" : n >= 3 && n <= 10 ? `${n} صور` : `${n} صورة`;

const EN = {
  "app.title": "Paperglass — Turn paper into clean scans",
  "app.description":
    "Photograph invoices, receipts and payment slips. Paperglass straightens the page, removes shadows and exports tidy images or a single PDF. Everything stays on your device.",

  "lang.other": "العربية",
  "lang.switchTo": "Switch to Arabic",

  "a11y.home": "Paperglass home",
  "a11y.scannedPages": "Scanned pages",
  "a11y.addPhotos": "Add photos",
  "a11y.addPhotosShortcut": "Add photos (O)",
  "a11y.upload": "Upload photos to scan",
  "a11y.features": "Features",
  "a11y.preview": "Scan preview",
  "a11y.rotateLeft": "Rotate left",
  "a11y.rotateRight": "Rotate right",
  "a11y.downloadPage": "Download this page",
  "a11y.enhancePanel": "Enhance scan",
  "a11y.look": "Scan look",
  "a11y.resetAdjustments": "Reset adjustments",
  "a11y.closeEnhance": "Close enhance panel",
  "a11y.deletePage": "Delete this page",
  "a11y.pageOptions": "Page options",
  "a11y.selectPages": "Select pages to remove",
  "a11y.selectPage": "Select this page",
  "a11y.cornerTL": "Move top-left corner",
  "a11y.cornerTR": "Move top-right corner",
  "a11y.cornerBR": "Move bottom-right corner",
  "a11y.cornerBL": "Move bottom-left corner",
  "a11y.exportFormat": "Export format",
  "a11y.paperSize": "Paper size",
  "a11y.imageFormat": "Image format",
  "a11y.closeExport": "Close export dialog",
  "a11y.closeDialog": "Close dialog",
  "a11y.closeCamera": "Close camera",

  "theme.toDark": "Switch to dark mode",
  "theme.toLight": "Switch to light mode",
  "theme.toDarkTitle": "Switch to dark mode (T)",
  "theme.toLightTitle": "Switch to light mode (T)",

  "topbar.ready": "Ready when you are",

  "install.prompt": "Install Paperglass for quick access and offline use.",
  "install.action": "Install",
  "install.done": "Paperglass installed",

  "actions.addPhotos": "Add photos",
  "actions.select": "Select",
  "actions.export": "Export",
  "actions.cancel": "Cancel",
  "actions.download": "Download",
  "actions.delete": "Delete",

  "pages.title": "Pages",
  "pages.none": "No pages yet",
  "pages.count": (v) => enPages(v.count),
  "page.summary": (v) => `${enPages(v.count)} · ${v.size}`,
  "page.delete": "Delete page",
  "panel.clearAll": "Clear all",
  "selection.count": (v) => `${v.count} selected`,
  "selection.none": "Tap pages to select",
  "selection.selectAll": "Select all",
  "selection.clearAll": "Deselect all",
  "save.saving": "Saving…",
  "save.saved": "Saved on this device",
  "save.error": "Not saved",

  "hero.eyebrow": "Private by design · on-device",
  "hero.title": "Paper in.<br /><em>Scans out.</em>",
  "hero.sub":
    "Photograph an invoice, receipt, or payment slip. Paperglass finds the page, squares it up, and wipes away shadows — ready to export as images or one tidy PDF.",
  "drop.title": "Drop your photos here",
  "drop.sub": "or click to browse · JPG, PNG, WebP",
  "drop.choose": "Choose photos",
  "drop.camera": "Take photo",
  "feature.edges": "Auto edge detection",
  "feature.shadow": "Shadow cleanup",
  "feature.pdf": "One tidy PDF",
  "feature.private": "Nothing uploaded",
  "privacy.note":
    "Your photos never leave this browser. Work is autosaved on this device only.",
  "dropOverlay.title": "Drop photos to scan",
  "dropOverlay.sub":
    "We’ll straighten and clean each page automatically.",

  "editor.adjustEdges": "Adjust edges",
  "editor.finishCrop": "Finish crop",
  "editor.enhance": "Enhance",
  "editor.tipEmpty": "Tip: drag the corners to fine-tune the crop.",
  "editor.tipCrop": "Drag each corner to the edge of the page. Auto-detect can help.",
  "editor.tipIdle": "Tip: use Adjust edges if a corner was cropped off.",
  "crop.auto": "Auto-detect",
  "crop.reset": "Reset",
  "crop.done": "Done",
  "crop.edgesDetected": "Edges detected",
  "crop.notFound": "Couldn't find the page edges — drag the corners instead",
  "crop.crossed": "Corners crossed — reverted",

  "inspector.title": "Enhance",
  "inspector.sub": "Scanner-quality in one tap",
  "inspector.look": "Look",
  "inspector.thisPage": "This page",
  "inspector.applyAll": "Apply look to all pages",
  "inspector.info":
    "<strong>Auto-cropped on import.</strong> Edges and shadows are corrected locally — no upload, no account.",
  "preset.clean.name": "Clean",
  "preset.clean.note": "Crisp scan",
  "preset.ink.name": "Ink",
  "preset.ink.note": "Pure black",
  "preset.color.name": "Colour",
  "preset.color.note": "Keeps ink",
  "preset.original.name": "Original",
  "preset.original.note": "No cleanup",
  "adjust.brightness": "Brightness",
  "adjust.contrast": "Contrast",
  "adjust.cleanup": "Shadow cleanup",
  "adjust.cleanupHint":
    "Flattens lighting and paper tone so the page reads cleanly.",
  "adjust.resetToast": "Adjustments reset",
  "page.moveUp": "Move up",
  "page.moveDown": "Move down",
  "apply.needTwo": "Add another page to apply a shared look",
  "apply.busy": "Applying look…",
  "apply.page": (v) => `Page ${v.index} of ${v.count}`,
  "apply.done": (v) => `Look applied to ${enPages(v.count)}`,

  "import.chooseImage": "Choose an image — JPG, PNG or WebP works best",
  "import.reading": "Reading photos…",
  "import.progress": (v) => `${v.index} of ${v.count}`,
  "import.scanning": (v) => `Scanning ${v.index} of ${v.count}`,
  "import.added": (v) => `${enPages(v.count)} added and cleaned`,
  "import.undetected": (v) =>
    `${enPhotos(v.count)} couldn't be auto-cropped — use Adjust edges`,
  "import.failed": (v) =>
    `Couldn't open ${enFiles(v.count)}. HEIC photos may need converting.`,

  "restore.title": "Restoring your scans…",
  "restore.page": (v) => `Restoring page ${v.index} of ${v.count}`,

  "export.title": "Export your scan",
  "export.subtitle": (v) => `${enPages(v.count)} · rendered on this device`,
  "export.pdf": "PDF document",
  "export.images": "Images",
  "export.paperSize": "Paper size",
  "export.imageQuality": "Image quality",
  "export.qHighPrint": "High — for printing",
  "export.qBalancedPrint": "Balanced — recommended",
  "export.qCompactPrint": "Compact — smaller file",
  "export.fileName": "File name",
  "export.pdfSummary": (v) => `1 PDF · ${enPages(v.count)} · ${v.paper}`,
  "export.pdfNote": "One document, pages in order",
  "export.format": "Format",
  "export.qHigh": "High",
  "export.qBalanced": "Balanced",
  "export.qCompact": "Compact",
  "export.imageSummary": (v) => enImages(v.count, v.ext),
  "export.zipNote": "Delivered as one ZIP",
  "export.singleNote": "Single file download",
  "export.downloadPdf": "Download PDF",
  "export.downloadZip": "Download ZIP",
  "export.downloadImage": "Download image",
  "export.buildingPdf": "Building your PDF…",
  "export.renderingPage": (v) => `Rendering page ${v.index} of ${v.count}`,
  "export.writingDoc": "Writing the document",
  "export.pdfReady": (v) => `PDF ready · ${enPages(v.count)}`,
  "export.exportingImages": "Exporting images…",
  "export.packingZip": "Packing the ZIP",
  "export.imageDownloaded": "Image downloaded",
  "export.zipReady": (v) => `ZIP ready · ${enImageWord(v.count)}`,
  "export.failed": "Export failed — try a smaller page or fewer photos",
  "export.preparingImage": "Preparing image…",
  "export.failedPage": "Could not export this page",
  "save.unavailable": "Autosave is unavailable — export to keep your scans",

  "confirm.title": "Delete session?",
  "confirm.message": "This removes every page from this device.",
  "confirm.clearTitle": "Clear this session?",
  "confirm.clearMessage": (v) =>
    `Remove ${enPages(v.count)} from this device? This can't be undone.`,
  "confirm.clearAll": "Clear all",

  "toast.sessionCleared": "Session cleared",
  "toast.pageRemoved": "Page removed",
  "toast.pagesRemoved": (v) => `${enPages(v.count)} removed`,
  "toast.undo": "Undo",
  "toast.pageRestored": "Page restored",
  "toast.pagesRestored": "Pages restored",
  "toast.renderFailed": "This page could not be rendered",

  "camera.title": "Take a photo",
  "camera.sub": "Fill the frame with the page and keep the light even.",
  "camera.error":
    "Camera unavailable. You can still choose a photo from your device.",
  "camera.chooseFile": "Choose a file",
  "camera.capture": "Capture",
  "camera.unavailable":
    "Camera unavailable. Check browser permission, or choose a photo from your device.",
  "camera.captureFailed": "Could not capture that photo",

  "busy.working": "Working on it…",
  "busy.detail": "This stays on your device.",
};

const AR = {
  "app.title": "Paperglass — حوّل الورق إلى مسوحات نظيفة",
  "app.description":
    "صوّر الفواتير والإيصالات وقسائم الدفع. يقوم Paperglass بتقويم الصفحة وإزالة الظلال وتصدير صور مرتبة أو ملف PDF واحد. كل شيء يبقى على جهازك.",

  "lang.other": "English",
  "lang.switchTo": "التبديل إلى الإنجليزية",

  "a11y.home": "الصفحة الرئيسية لـ Paperglass",
  "a11y.scannedPages": "الصفحات الممسوحة",
  "a11y.addPhotos": "إضافة صور",
  "a11y.addPhotosShortcut": "إضافة صور (O)",
  "a11y.upload": "ارفع صورًا لمسحها",
  "a11y.features": "المزايا",
  "a11y.preview": "معاينة المسح",
  "a11y.rotateLeft": "تدوير لليسار",
  "a11y.rotateRight": "تدوير لليمين",
  "a11y.downloadPage": "تنزيل هذه الصفحة",
  "a11y.enhancePanel": "تحسين المسح",
  "a11y.look": "مظهر المسح",
  "a11y.resetAdjustments": "إعادة ضبط التعديلات",
  "a11y.closeEnhance": "إغلاق لوحة التحسين",
  "a11y.deletePage": "حذف هذه الصفحة",
  "a11y.pageOptions": "خيارات الصفحة",
  "a11y.selectPages": "تحديد صفحات لإزالتها",
  "a11y.selectPage": "تحديد هذه الصفحة",
  "a11y.cornerTL": "تحريك الزاوية العلوية اليسرى",
  "a11y.cornerTR": "تحريك الزاوية العلوية اليمنى",
  "a11y.cornerBR": "تحريك الزاوية السفلية اليمنى",
  "a11y.cornerBL": "تحريك الزاوية السفلية اليسرى",
  "a11y.exportFormat": "صيغة التصدير",
  "a11y.paperSize": "حجم الورق",
  "a11y.imageFormat": "صيغة الصورة",
  "a11y.closeExport": "إغلاق نافذة التصدير",
  "a11y.closeDialog": "إغلاق النافذة",
  "a11y.closeCamera": "إغلاق الكاميرا",

  "theme.toDark": "التبديل إلى الوضع الداكن",
  "theme.toLight": "التبديل إلى الوضع الفاتح",
  "theme.toDarkTitle": "التبديل إلى الوضع الداكن (T)",
  "theme.toLightTitle": "التبديل إلى الوضع الفاتح (T)",

  "topbar.ready": "جاهز للبدء",

  "install.prompt": "ثبّت Paperglass للوصول السريع والاستخدام دون اتصال.",
  "install.action": "تثبيت",
  "install.done": "تم تثبيت Paperglass",

  "actions.addPhotos": "إضافة صور",
  "actions.select": "تحديد",
  "actions.export": "تصدير",
  "actions.cancel": "إلغاء",
  "actions.download": "تنزيل",
  "actions.delete": "حذف",

  "pages.title": "الصفحات",
  "pages.none": "لا توجد صفحات بعد",
  "pages.count": (v) => arPages(v.count),
  "page.summary": (v) => `${arPages(v.count)} · ${v.size}`,
  "page.delete": "حذف الصفحة",
  "panel.clearAll": "مسح الكل",
  "selection.count": (v) => `المحدد: ${v.count}`,
  "selection.none": "انقر الصفحات لتحديدها",
  "selection.selectAll": "تحديد الكل",
  "selection.clearAll": "إلغاء تحديد الكل",
  "save.saving": "جارٍ الحفظ…",
  "save.saved": "محفوظ على هذا الجهاز",
  "save.error": "لم يُحفظ",

  "hero.eyebrow": "خاص بحكم التصميم · على الجهاز",
  "hero.title": "ورق يدخل.<br /><em>مسوحات تخرج.</em>",
  "hero.sub":
    "صوّر فاتورة أو إيصالًا أو قسيمة دفع. يعثر Paperglass على الصفحة ويقوّمها ويزيل الظلال — جاهزة للتصدير كصور أو ملف PDF واحد مرتب.",
  "drop.title": "أفلت صورك هنا",
  "drop.sub": "أو انقر للتصفح · JPG، PNG، WebP",
  "drop.choose": "اختر الصور",
  "drop.camera": "التقط صورة",
  "feature.edges": "كشف تلقائي للحواف",
  "feature.shadow": "إزالة الظلال",
  "feature.pdf": "ملف PDF واحد مرتب",
  "feature.private": "لا يُرفع أي شيء",
  "privacy.note":
    "صورك لا تغادر هذا المتصفح أبدًا. يُحفظ عملك تلقائيًا على هذا الجهاز فقط.",
  "dropOverlay.title": "أفلت الصور للمسح",
  "dropOverlay.sub": "سنقوّم وننظّف كل صفحة تلقائيًا.",

  "editor.adjustEdges": "ضبط الحواف",
  "editor.finishCrop": "إنهاء الاقتصاص",
  "editor.enhance": "تحسين",
  "editor.tipEmpty": "نصيحة: اسحب الزوايا لضبط الاقتصاص بدقة.",
  "editor.tipCrop":
    "اسحب كل زاوية إلى حافة الصفحة. يمكن أن يساعد الكشف التلقائي.",
  "editor.tipIdle": "نصيحة: استخدم ضبط الحواف إذا قُصّت إحدى الزوايا.",
  "crop.auto": "كشف تلقائي",
  "crop.reset": "إعادة ضبط",
  "crop.done": "تم",
  "crop.edgesDetected": "تم اكتشاف الحواف",
  "crop.notFound": "تعذّر العثور على حواف الصفحة — اسحب الزوايا بدلًا من ذلك",
  "crop.crossed": "تقاطعت الزوايا — تم التراجع",

  "inspector.title": "تحسين",
  "inspector.sub": "جودة ماسح ضوئي بلمسة واحدة",
  "inspector.look": "المظهر",
  "inspector.thisPage": "هذه الصفحة",
  "inspector.applyAll": "تطبيق المظهر على كل الصفحات",
  "inspector.info":
    "<strong>اقتصاص تلقائي عند الاستيراد.</strong> تُصحَّح الحواف والظلال محليًا — بلا رفع، بلا حساب.",
  "preset.clean.name": "نظيف",
  "preset.clean.note": "مسح واضح",
  "preset.ink.name": "حبر",
  "preset.ink.note": "أسود نقي",
  "preset.color.name": "ملوّن",
  "preset.color.note": "يحافظ على الحبر",
  "preset.original.name": "الأصل",
  "preset.original.note": "بلا تنظيف",
  "adjust.brightness": "السطوع",
  "adjust.contrast": "التباين",
  "adjust.cleanup": "إزالة الظلال",
  "adjust.cleanupHint":
    "يوحّد الإضاءة ولون الورق لتظهر الصفحة بشكل نظيف.",
  "adjust.resetToast": "تمت إعادة ضبط التعديلات",
  "page.moveUp": "تحريك لأعلى",
  "page.moveDown": "تحريك لأسفل",
  "apply.needTwo": "أضف صفحة أخرى لتطبيق مظهر مشترك",
  "apply.busy": "جارٍ تطبيق المظهر…",
  "apply.page": (v) => `الصفحة ${v.index} من ${v.count}`,
  "apply.done": (v) => `تم تطبيق المظهر على ${arPagesObj(v.count)}`,

  "import.chooseImage": "اختر صورة — الأفضل استخدام JPG أو PNG أو WebP",
  "import.reading": "جارٍ قراءة الصور…",
  "import.progress": (v) => `${v.index} من ${v.count}`,
  "import.scanning": (v) => `جارٍ مسح ${v.index} من ${v.count}`,
  "import.added": (v) =>
    v.count === 1
      ? "تمت إضافة صفحة واحدة وتنظيفها"
      : v.count === 2
        ? "تمت إضافة صفحتين وتنظيفهما"
        : v.count >= 3 && v.count <= 10
          ? `تمت إضافة ${v.count} صفحات وتنظيفها`
          : `تمت إضافة ${v.count} صفحة وتنظيفها`,
  "import.undetected": (v) =>
    v.count === 1
      ? "تعذّر اقتصاص صورة واحدة تلقائيًا — استخدم ضبط الحواف"
      : v.count === 2
        ? "تعذّر اقتصاص صورتين تلقائيًا — استخدم ضبط الحواف"
        : v.count >= 3 && v.count <= 10
          ? `تعذّر اقتصاص ${v.count} صور تلقائيًا — استخدم ضبط الحواف`
          : `تعذّر اقتصاص ${v.count} صورة تلقائيًا — استخدم ضبط الحواف`,
  "import.failed": (v) =>
    `تعذّر فتح ${arFiles(v.count)}. قد تحتاج صور HEIC إلى تحويل.`,

  "restore.title": "جارٍ استعادة مسوحاتك…",
  "restore.page": (v) => `جارٍ استعادة الصفحة ${v.index} من ${v.count}`,

  "export.title": "تصدير المسح",
  "export.subtitle": (v) => `${arPages(v.count)} · تُجهَّز على هذا الجهاز`,
  "export.pdf": "مستند PDF",
  "export.images": "صور",
  "export.paperSize": "حجم الورق",
  "export.imageQuality": "جودة الصورة",
  "export.qHighPrint": "عالية — للطباعة",
  "export.qBalancedPrint": "متوازنة — موصى بها",
  "export.qCompactPrint": "مضغوطة — ملف أصغر",
  "export.fileName": "اسم الملف",
  "export.pdfSummary": (v) => `ملف PDF واحد · ${arPages(v.count)} · ${v.paper}`,
  "export.pdfNote": "مستند واحد، الصفحات بالترتيب",
  "export.format": "الصيغة",
  "export.qHigh": "عالية",
  "export.qBalanced": "متوازنة",
  "export.qCompact": "مضغوطة",
  "export.imageSummary": (v) => arImages(v.count, v.ext),
  "export.zipNote": "يُسلَّم كملف ZIP واحد",
  "export.singleNote": "تنزيل ملف واحد",
  "export.downloadPdf": "تنزيل PDF",
  "export.downloadZip": "تنزيل ZIP",
  "export.downloadImage": "تنزيل الصورة",
  "export.buildingPdf": "جارٍ إنشاء ملف PDF…",
  "export.renderingPage": (v) => `جارٍ تصيير الصفحة ${v.index} من ${v.count}`,
  "export.writingDoc": "جارٍ كتابة المستند",
  "export.pdfReady": (v) => `ملف PDF جاهز · ${arPages(v.count)}`,
  "export.exportingImages": "جارٍ تصدير الصور…",
  "export.packingZip": "جارٍ تجهيز ملف ZIP",
  "export.imageDownloaded": "تم تنزيل الصورة",
  "export.zipReady": (v) => `ملف ZIP جاهز · ${arImageWord(v.count)}`,
  "export.failed": "فشل التصدير — جرّب صفحة أصغر أو صورًا أقل",
  "export.preparingImage": "جارٍ تجهيز الصورة…",
  "export.failedPage": "تعذّر تصدير هذه الصفحة",
  "save.unavailable": "الحفظ التلقائي غير متاح — صدّر مسوحاتك للاحتفاظ بها",

  "confirm.title": "حذف الجلسة؟",
  "confirm.message": "سيؤدي هذا إلى إزالة كل صفحة من هذا الجهاز.",
  "confirm.clearTitle": "مسح هذه الجلسة؟",
  "confirm.clearMessage": (v) =>
    `إزالة ${arPagesObj(v.count)} من هذا الجهاز؟ لا يمكن التراجع عن هذا.`,
  "confirm.clearAll": "مسح الكل",

  "toast.sessionCleared": "تم مسح الجلسة",
  "toast.pageRemoved": "تمت إزالة الصفحة",
  "toast.pagesRemoved": (v) => `تمت إزالة ${arPagesObj(v.count)}`,
  "toast.undo": "تراجع",
  "toast.pageRestored": "تمت استعادة الصفحة",
  "toast.pagesRestored": "تمت استعادة الصفحات",
  "toast.renderFailed": "تعذّر عرض هذه الصفحة",

  "camera.title": "التقط صورة",
  "camera.sub": "املأ الإطار بالصفحة وحافظ على إضاءة متساوية.",
  "camera.error": "الكاميرا غير متاحة. يمكنك مع ذلك اختيار صورة من جهازك.",
  "camera.chooseFile": "اختر ملفًا",
  "camera.capture": "التقاط",
  "camera.unavailable":
    "الكاميرا غير متاحة. تحقق من إذن المتصفح، أو اختر صورة من جهازك.",
  "camera.captureFailed": "تعذّر التقاط تلك الصورة",

  "busy.working": "جارٍ العمل…",
  "busy.detail": "كل شيء يبقى على جهازك.",
};

const DICT = { en: EN, ar: AR };
const listeners = new Set();
let lang = "en";

export function getLang() {
  return lang;
}

export function isRTL() {
  return lang === "ar";
}

export function t(key, vars = {}) {
  const entry = DICT[lang][key] ?? EN[key] ?? key;
  if (typeof entry === "function") return entry(vars);
  return String(entry).replace(/\{(\w+)\}/g, (_, name) =>
    vars[name] === undefined ? "" : String(vars[name])
  );
}

/** Translate every element carrying a data-i18n* attribute. */
export function applyTranslations(root = document) {
  root.querySelectorAll("[data-i18n]").forEach((element) => {
    element.textContent = t(element.dataset.i18n);
  });
  root.querySelectorAll("[data-i18n-html]").forEach((element) => {
    element.innerHTML = t(element.dataset.i18nHtml);
  });
  root.querySelectorAll("[data-i18n-aria]").forEach((element) => {
    element.setAttribute("aria-label", t(element.dataset.i18nAria));
  });
  root.querySelectorAll("[data-i18n-title]").forEach((element) => {
    element.setAttribute("title", t(element.dataset.i18nTitle));
  });

  document.title = t("app.title");
  const description = document.querySelector('meta[name="description"]');
  if (description) description.setAttribute("content", t("app.description"));
}

function applyLanguage() {
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
  applyTranslations();
}

export function initI18n() {
  let saved = null;
  try {
    saved = localStorage.getItem(STORAGE_KEY);
  } catch (error) {
    /* private mode */
  }

  if (saved === "en" || saved === "ar") {
    lang = saved;
  } else {
    const preferred =
      (Array.isArray(navigator.languages) && navigator.languages[0]) ||
      navigator.language ||
      "en";
    lang = /^ar\b/i.test(preferred) ? "ar" : "en";
  }

  applyLanguage();
  return lang;
}

export function setLang(next) {
  if (next !== "en" && next !== "ar") return lang;
  const changed = next !== lang;
  lang = next;
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch (error) {
    /* private mode */
  }
  applyLanguage();
  if (changed) listeners.forEach((listener) => listener(lang));
  return lang;
}

export function onLangChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
